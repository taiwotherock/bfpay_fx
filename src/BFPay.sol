// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/**
 * @title  BFPay — Borderless Fuse Pay
 * @notice B2B cross-border lending with:
 *   ✅ USYC deposit  → convert USDC to yield-bearing USYC as collateral
 *   ✅ USYC redeem   → auto-return USDC + accrued yield on repayment
 *   ✅ StableFX lock → firm USDC/NGN rate locked at quote acceptance
 *   ✅ Yield offset  → USYC yield reduces borrower's net daily fee
 *   ✅ Health factor → onchain attestation every 60s via oracle
 *   ✅ Fiat payout   → confirmed via oracle (NGN via banking partner)
 */

// ─── Interfaces ───────────────────────────────────────────────────────────────

interface IERC20 {
    function transferFrom(address, address, uint256) external returns (bool);
    function transfer(address, uint256) external returns (bool);
    function balanceOf(address) external view returns (uint256);
    function approve(address, uint256) external returns (bool);
}

/// @notice Hashnote USYC Vault — subscribe USDC → USYC, redeem USYC → USDC+yield
interface IUSYCVault {
    function subscribe(uint256 usdcAmount)   external returns (uint256 usycMinted);
    function redeem(uint256 usycAmount)      external returns (uint256 usdcOut);
    function getRedemptionValue(uint256 usycAmount) external view returns (uint256 usdcValue);
    function pricePerShare()                 external view returns (uint256);
}

/// @notice Circle StableFX — onchain FX rate reference
interface IStableFX {
    function getReferenceRate(address base, bytes32 quote)
        external view returns (uint256 rate, uint256 updatedAt);
}

// ─── Contract ─────────────────────────────────────────────────────────────────

contract BFPay {

    // ── Constants ─────────────────────────────────────────────────────────────
    uint256 public constant PRECISION    = 1e18;
    uint256 public constant USDC_DEC     = 1e6;
    uint256 public constant MAX_FEE_BPS  = 30;        // 0.30%/day max
    bytes32 public constant NGN_CODE     = bytes32("NGN");

    // ── Enums ─────────────────────────────────────────────────────────────────
    enum DealStatus  { OPEN, MATCHED, ACTIVE, REPAID, LIQUIDATED }
    enum CollType    { USYC, USDC, GBP_FIAT, USD_FIAT, EUR_FIAT }
    enum HealthState { HEALTHY, WARNING, MARGIN_CALL, LIQUIDATING }

    // ── Structs ───────────────────────────────────────────────────────────────

    struct CollateralPosition {
        CollType collType;
        uint256  usycTokens;       // USYC locked (if CollType.USYC)
        uint256  usdcDeposited;    // USDC locked (if CollType.USDC)
        uint256  usdcValueAtLock;  // USDC value when deposited (6 dec)
        uint256  depositedAt;
    }

    struct LockedRate {
        uint256 ngnPerUsdc;   // NGN per 1 USDC × 1e6  e.g. 1_580_000_000
        uint256 lockedAt;
        uint256 expiresAt;
        bool    active;
    }

    struct RFQ {
        bytes32   id;
        address   borrower;
        uint256   amountNGN;      // whole Naira
        uint256   tenorDays;
        uint256   maxFeeBPS;
        CollType  collateral;
        uint256   collateralUSD;  // USD × 1e6
        uint256   createdAt;
        bool      open;
    }

    struct Quote {
        bytes32 rfqId;
        address lender;
        uint256 feeBPS;
        uint256 validUntil;
        bool    accepted;
    }

    struct Deal {
        bytes32    id;
        bytes32    rfqId;
        address    borrower;
        address    lender;
        uint256    amountNGN;
        uint256    collateralUSD;
        uint256    feeBPS;
        uint256    openedAt;
        uint256    tenorDays;
        uint256    healthFactor;
        uint8      healthState;
        uint8      collType;
        DealStatus status;
        string     fiatPayoutRef;
        string     fiatRepayRef;
    }

    struct Attestation {
        bytes32 dealId;
        uint256 collateralUSD;
        uint256 drawnNGN;
        uint256 yieldAccruedUSDC;
        uint256 netFeeNGN;
        uint256 healthFactor;
        uint8   healthState;
        uint256 timestamp;
        address oracle;
    }

    // ── External addresses ────────────────────────────────────────────────────
    address public usycVault;
    address public usycToken;
    address public usdc;
    address public stableFX;

    // ── State ─────────────────────────────────────────────────────────────────
    address public owner;
    uint256 public ltvBPS      = 8000;
    uint256 public gracePeriod = 4 hours;

    mapping(address => bool)    public isOracle;
    mapping(address => bool)    public isKYB;
    mapping(bytes32 => RFQ)     public rfqs;
    bytes32[]                   public rfqList;
    mapping(bytes32 => Quote[]) public quotes;
    mapping(bytes32 => Deal)    public deals;
    bytes32[]                   public dealList;

    mapping(bytes32 => CollateralPosition) public positions;
    mapping(bytes32 => LockedRate)         public lockedRates;
    mapping(bytes32 => Attestation[])      public history;
    mapping(bytes32 => uint256)            public marginCallAt;
    mapping(address => uint256)            public oracleNonce;

    // ── Events ────────────────────────────────────────────────────────────────
    event KYBApproved       (address indexed user);
    event RFQCreated        (bytes32 indexed id, address borrower, uint256 amountNGN, uint8 collType);
    event QuoteSubmitted    (bytes32 indexed rfqId, address lender, uint256 feeBPS);
    event DealOpened        (bytes32 indexed dealId, address borrower, address lender);
    event USYCDeposited     (bytes32 indexed dealId, uint256 usycTokens, uint256 usdcIn);
    event USYCRedeemed      (bytes32 indexed dealId, address recipient, uint256 usycTokens, uint256 usdcOut);
    event USDCDeposited     (bytes32 indexed dealId, uint256 amount);
    event USDCReleased      (bytes32 indexed dealId, address recipient, uint256 amount);
    event FXRateLocked      (bytes32 indexed dealId, uint256 ngnPerUsdc, uint256 expiresAt);
    event YieldOffset       (bytes32 indexed dealId, uint256 yieldUSDC, uint256 yieldNGN, uint256 netFeeNGN);
    event PayoutConfirmed   (bytes32 indexed dealId, string fiatRef);
    event Repaid            (bytes32 indexed dealId, string fiatRef);
    event Attested          (bytes32 indexed dealId, uint256 healthFactor, uint8 state);
    event MarginCall        (bytes32 indexed dealId, uint256 endsAt);
    event Liquidated        (bytes32 indexed dealId);

    // ── Modifiers ─────────────────────────────────────────────────────────────
    modifier onlyOwner()  { require(msg.sender == owner,  "not owner");  _; }
    modifier onlyOracle() { require(isOracle[msg.sender], "not oracle"); _; }
    modifier onlyKYB()    { require(isKYB[msg.sender],    "not KYB");    _; }

    constructor(address _usycVault, address _usycToken, address _usdc, address _stableFX) {
        owner     = msg.sender;
        usycVault = _usycVault;
        usycToken = _usycToken;
        usdc      = _usdc;
        stableFX  = _stableFX;
    }

    // ══════════════════════════════════════════════════════════════════════════
    // SECTION A — ADMIN
    // ══════════════════════════════════════════════════════════════════════════

    function addOracle(address _o) external onlyOwner { isOracle[_o] = true; }

    function approveKYB(address _u) external onlyOwner {
        isKYB[_u] = true;
        emit KYBApproved(_u);
    }

    function setLTV(uint256 _bps) external onlyOwner {
        require(_bps <= 9500); ltvBPS = _bps;
    }

    function setAddresses(address _vault, address _usyc, address _usdc_, address _sfx)
        external onlyOwner
    {
        usycVault = _vault; usycToken = _usyc; usdc = _usdc_; stableFX = _sfx;
    }

    // ══════════════════════════════════════════════════════════════════════════
    // SECTION B — USYC DEPOSIT
    // Borrower approves USDC → contract converts to USYC → locks in vault
    // USYC earns ~5% APY while collateral is locked → offsets daily fee
    // ══════════════════════════════════════════════════════════════════════════

    /**
     * @notice  Lock USDC as USYC collateral for a deal.
     *          Borrower calls this after acceptQuote().
     * @param   _dealId       The matched deal to back
     * @param   _usdcAmount   USDC amount (6 decimals, e.g. 100_000e6 = $100K)
     *
     * @dev     Step 1: Pull USDC from borrower
     *          Step 2: Approve USYC vault
     *          Step 3: Vault converts USDC → USYC (Hashnote T-bill fund)
     *          Step 4: USYC stays in this contract, tracked per deal
     */
    function depositUSYC(bytes32 _dealId, uint256 _usdcAmount) external onlyKYB {
        require(_usdcAmount > 0,                        "zero amount");
        Deal storage d = deals[_dealId];
        require(d.borrower == msg.sender,               "not borrower");
        require(d.status   == DealStatus.MATCHED,       "wrong status");
        require(d.collType == uint8(CollType.USYC),     "not USYC deal");

        // 1. Pull USDC from borrower into this contract
        require(IERC20(usdc).transferFrom(msg.sender, address(this), _usdcAmount), "usdc pull failed");

        // 2. Approve vault to spend USDC
        IERC20(usdc).approve(usycVault, _usdcAmount);

        // 3. Subscribe USDC → USYC via Hashnote vault
        uint256 usycMinted = IUSYCVault(usycVault).subscribe(_usdcAmount);
        require(usycMinted > 0, "no USYC minted");

        // 4. Record position — USYC stays in this contract
        positions[_dealId] = CollateralPosition({
            collType:       CollType.USYC,
            usycTokens:     usycMinted,
            usdcDeposited:  0,
            usdcValueAtLock: _usdcAmount,
            depositedAt:    block.timestamp
        });

        d.collateralUSD = _usdcAmount;

        emit USYCDeposited(_dealId, usycMinted, _usdcAmount);
    }

    // ══════════════════════════════════════════════════════════════════════════
    // SECTION C — USYC REDEEM
    // On repayment: redeem USYC → USDC+yield → return to borrower
    // On liquidation: USDC goes to lender as compensation
    // ══════════════════════════════════════════════════════════════════════════

    /**
     * @notice  Manually trigger USYC redemption for a repaid deal.
     *          Normally called automatically by confirmRepayment().
     *          Also callable by oracle for manual overrides.
     */
    function redeemUSYC(bytes32 _dealId) external onlyOracle {
        Deal storage d = deals[_dealId];
        require(
            d.status == DealStatus.REPAID || d.status == DealStatus.LIQUIDATED,
            "not settled"
        );

        CollateralPosition storage pos = positions[_dealId];
        require(pos.collType == CollType.USYC, "not USYC position");
        require(pos.usycTokens > 0,            "already redeemed");

        _executeUSYCRedeem(_dealId);
    }

    // ══════════════════════════════════════════════════════════════════════════
    // SECTION D — USDC DEPOSIT & RELEASE (raw USDC collateral, no yield)
    // ══════════════════════════════════════════════════════════════════════════

    function depositUSDC(bytes32 _dealId, uint256 _amount) external onlyKYB {
        Deal storage d = deals[_dealId];
        require(d.borrower == msg.sender,            "not borrower");
        require(d.status   == DealStatus.MATCHED,    "wrong status");
        require(d.collType == uint8(CollType.USDC),  "not USDC deal");

        require(IERC20(usdc).transferFrom(msg.sender, address(this), _amount), "usdc pull failed");

        positions[_dealId] = CollateralPosition({
            collType:       CollType.USDC,
            usycTokens:     0,
            usdcDeposited:  _amount,
            usdcValueAtLock: _amount,
            depositedAt:    block.timestamp
        });

        d.collateralUSD = _amount;
        emit USDCDeposited(_dealId, _amount);
    }

    function releaseUSDC(bytes32 _dealId) external onlyOracle {
        Deal storage d = deals[_dealId];
        require(d.status == DealStatus.REPAID, "not repaid");
        _releaseUSDCInternal(_dealId, d.borrower);
    }

    // ══════════════════════════════════════════════════════════════════════════
    // SECTION E — CIRCLE STABLEFX RATE LOCK
    // Locks USDC/NGN rate at quote acceptance — neither party bears FX risk
    // ══════════════════════════════════════════════════════════════════════════

    /**
     * @notice  Lock the StableFX USDC/NGN rate for this deal.
     *          Called automatically inside acceptQuote() if StableFX is set.
     *          Borrower can also call manually if auto-lock failed.
     */
    function lockFXRate(bytes32 _dealId) external onlyKYB {
        Deal storage d = deals[_dealId];
        require(d.borrower == msg.sender,         "not borrower");
        require(d.status   == DealStatus.MATCHED, "wrong status");
        require(!lockedRates[_dealId].active,     "already locked");
        _doLockRate(_dealId);
    }

    /**
     * @notice  Credit line in NGN = collateralUSD × lockedRate × LTV
     *          Uses the locked StableFX rate — not live market.
     */
    function getCreditLineNGN(bytes32 _dealId) external view returns (uint256) {
        Deal memory d     = deals[_dealId];
        LockedRate memory r = lockedRates[_dealId];
        require(r.active, "no rate locked");
        // collateralUSD (1e6) × ngnPerUsdc (1e6) × ltvBPS / (1e6 × 1e6 × 10000)
        return (d.collateralUSD * r.ngnPerUsdc * ltvBPS) / (1e12 * 10000);
    }

    // ══════════════════════════════════════════════════════════════════════════
    // SECTION F — RFQ
    // ══════════════════════════════════════════════════════════════════════════

    function createRFQ(
        uint256  _amountNGN,
        uint256  _tenorDays,
        uint256  _maxFeeBPS,
        CollType _collateral,
        uint256  _collateralUSD
    ) external onlyKYB returns (bytes32 id) {
        require(_amountNGN > 0 && _tenorDays > 0,  "invalid params");
        require(_maxFeeBPS <= MAX_FEE_BPS,          "fee too high");

        id = keccak256(abi.encodePacked(msg.sender, block.timestamp, _amountNGN));

        rfqs[id] = RFQ({
            id:            id,
            borrower:      msg.sender,
            amountNGN:     _amountNGN,
            tenorDays:     _tenorDays,
            maxFeeBPS:     _maxFeeBPS,
            collateral:    _collateral,
            collateralUSD: _collateralUSD,
            createdAt:     block.timestamp,
            open:          true
        });
        rfqList.push(id);
        emit RFQCreated(id, msg.sender, _amountNGN, uint8(_collateral));
    }

    // ══════════════════════════════════════════════════════════════════════════
    // SECTION G — QUOTE
    // ══════════════════════════════════════════════════════════════════════════

    function submitQuote(bytes32 _rfqId, uint256 _feeBPS, uint256 _validSecs) external onlyKYB {
        RFQ storage rfq = rfqs[_rfqId];
        require(rfq.open && _feeBPS <= rfq.maxFeeBPS, "invalid quote");
        quotes[_rfqId].push(Quote({
            rfqId:      _rfqId,
            lender:     msg.sender,
            feeBPS:     _feeBPS,
            validUntil: block.timestamp + _validSecs,
            accepted:   false
        }));
        emit QuoteSubmitted(_rfqId, msg.sender, _feeBPS);
    }

    // ══════════════════════════════════════════════════════════════════════════
    // SECTION H — ACCEPT QUOTE → Deal opened + StableFX auto-locked
    // ══════════════════════════════════════════════════════════════════════════

    function acceptQuote(bytes32 _rfqId, uint256 _idx) external returns (bytes32 dealId) {
        RFQ storage rfq     = rfqs[_rfqId];
        Quote storage quote = quotes[_rfqId][_idx];

        require(msg.sender == rfq.borrower,          "not borrower");
        require(rfq.open && !quote.accepted,         "not open");
        require(block.timestamp <= quote.validUntil, "quote expired");

        quote.accepted = true;
        rfq.open       = false;

        dealId = keccak256(abi.encodePacked(_rfqId, quote.lender, block.timestamp));

        deals[dealId] = Deal({
            id:            dealId,
            rfqId:         _rfqId,
            borrower:      rfq.borrower,
            lender:        quote.lender,
            amountNGN:     rfq.amountNGN,
            collateralUSD: rfq.collateralUSD,
            feeBPS:        quote.feeBPS,
            openedAt:      block.timestamp,
            tenorDays:     rfq.tenorDays,
            healthFactor:  PRECISION,
            healthState:   uint8(HealthState.HEALTHY),
            collType:      uint8(rfq.collateral),
            status:        DealStatus.MATCHED,
            fiatPayoutRef: "",
            fiatRepayRef:  ""
        });
        dealList.push(dealId);

        // Auto-lock StableFX rate — non-blocking
        if (stableFX != address(0)) {
            try this.lockFXRateInternal(dealId) {} catch {}
        }

        emit DealOpened(dealId, rfq.borrower, quote.lender);
    }

    /// @dev Internal entry point for auto-lock inside acceptQuote
    function lockFXRateInternal(bytes32 _dealId) external {
        require(msg.sender == address(this), "internal only");
        _doLockRate(_dealId);
    }

    // ══════════════════════════════════════════════════════════════════════════
    // SECTION I — SETTLEMENT (payout + repayment confirmation)
    // ══════════════════════════════════════════════════════════════════════════

    function confirmPayout(bytes32 _dealId, string calldata _ref) external onlyOracle {
        Deal storage d = deals[_dealId];
        require(d.status == DealStatus.MATCHED, "wrong status");
        d.status = DealStatus.ACTIVE;
        d.fiatPayoutRef = _ref;
        emit PayoutConfirmed(_dealId, _ref);
    }

    /**
     * @notice  Oracle confirms NGN repayment received.
     *          Automatically redeems USYC → USDC+yield to borrower,
     *          or releases USDC collateral. Emits yield offset summary.
     */
    function confirmRepayment(bytes32 _dealId, string calldata _ref) external onlyOracle {
        Deal storage d = deals[_dealId];
        require(d.status == DealStatus.ACTIVE, "not active");
        d.status      = DealStatus.REPAID;
        d.fiatRepayRef = _ref;
        emit Repaid(_dealId, _ref);

        // Auto-release onchain collateral
        CollateralPosition storage pos = positions[_dealId];
        if (pos.collType == CollType.USYC && pos.usycTokens > 0) {
            _executeUSYCRedeem(_dealId);
        } else if (pos.collType == CollType.USDC && pos.usdcDeposited > 0) {
            _releaseUSDCInternal(_dealId, d.borrower);
        }
        // GBP/USD/EUR fiat: banking partner releases JNVA via API offchain
    }

    // ══════════════════════════════════════════════════════════════════════════
    // SECTION J — ORACLE ATTESTATION
    // Pushes signed JNVA balance onchain every 60s as proof of reserve
    // For USYC deals: uses live vault price, not oracle-reported value
    // ══════════════════════════════════════════════════════════════════════════

    function attest(
        bytes32  _dealId,
        uint256  _collateralUSD,  // fiat JNVA balance in USD × 1e6 (ignored for USYC)
        uint256  _drawnNGN,       // outstanding NGN draw (whole units)
        uint256  _ngnUsdRate,     // live market NGN per USD × 1e6
        uint256  _nonce,
        bytes calldata _sig
    ) external onlyOracle {
        require(_nonce == oracleNonce[msg.sender], "bad nonce");
        oracleNonce[msg.sender]++;

        // Verify signature
        bytes32 h = keccak256(abi.encodePacked(
            "\x19Ethereum Signed Message:\n32",
            keccak256(abi.encodePacked(_dealId, _collateralUSD, _drawnNGN, _ngnUsdRate, _nonce, block.chainid))
        ));
        require(_recover(h, _sig) == msg.sender, "bad sig");

        Deal storage d = deals[_dealId];
        CollateralPosition memory pos = positions[_dealId];

        // For USYC: use live vault valuation (always appreciates)
        uint256 effColl = _collateralUSD;
        if (pos.collType == CollType.USYC && pos.usycTokens > 0) {
            effColl = IUSYCVault(usycVault).getRedemptionValue(pos.usycTokens);
        }

        // Health factor: (collUSD × LTV) / drawnUSD
        // drawnUSD = drawnNGN / ngnPerUsd
        uint256 drawnUSD = (_drawnNGN * USDC_DEC) / _ngnUsdRate;
        uint256 hf = drawnUSD == 0
            ? type(uint256).max
            : (effColl * ltvBPS * PRECISION) / (drawnUSD * 10000);

        uint8 state = _healthState(_dealId, hf);
        d.healthFactor  = hf;
        d.healthState   = state;
        d.collateralUSD = effColl;

        // Compute yield & net fee for this snapshot
        uint256 yieldUSDC;
        uint256 netFeeNGN;
        uint256 daysElapsed = (block.timestamp - d.openedAt) / 1 days;
        uint256 grossFee    = (d.amountNGN * d.feeBPS * daysElapsed) / 10000;

        if (pos.collType == CollType.USYC && pos.usycTokens > 0) {
            yieldUSDC = effColl > pos.usdcValueAtLock ? effColl - pos.usdcValueAtLock : 0;
            LockedRate memory r = lockedRates[_dealId];
            uint256 yieldNGN   = r.active ? (yieldUSDC * r.ngnPerUsdc) / 1e12 : 0;
            netFeeNGN          = grossFee > yieldNGN ? grossFee - yieldNGN : 0;
            if (yieldUSDC > 0) emit YieldOffset(_dealId, yieldUSDC, yieldNGN, netFeeNGN);
        } else {
            netFeeNGN = grossFee;
        }

        history[_dealId].push(Attestation({
            dealId:           _dealId,
            collateralUSD:    effColl,
            drawnNGN:         _drawnNGN,
            yieldAccruedUSDC: yieldUSDC,
            netFeeNGN:        netFeeNGN,
            healthFactor:     hf,
            healthState:      state,
            timestamp:        block.timestamp,
            oracle:           msg.sender
        }));

        emit Attested(_dealId, hf, state);

        if (state == uint8(HealthState.LIQUIDATING)) {
            d.status = DealStatus.LIQUIDATED;
            if (pos.collType == CollType.USYC && pos.usycTokens > 0) _executeUSYCRedeem(_dealId);
            emit Liquidated(_dealId);
        }
    }

    // ══════════════════════════════════════════════════════════════════════════
    // SECTION K — VIEW FUNCTIONS
    // ══════════════════════════════════════════════════════════════════════════

    function calculateFee(bytes32 _dealId)
        external view
        returns (uint256 grossFee, uint256 yieldOffset, uint256 netFee, uint256 daysElapsed)
    {
        Deal memory d = deals[_dealId];
        daysElapsed   = (block.timestamp - d.openedAt) / 1 days;
        grossFee      = (d.amountNGN * d.feeBPS * daysElapsed) / 10000;

        CollateralPosition memory pos = positions[_dealId];
        LockedRate memory r           = lockedRates[_dealId];

        if (pos.collType == CollType.USYC && pos.usycTokens > 0 && r.active) {
            uint256 curr   = IUSYCVault(usycVault).getRedemptionValue(pos.usycTokens);
            uint256 yield_ = curr > pos.usdcValueAtLock ? curr - pos.usdcValueAtLock : 0;
            yieldOffset    = (yield_ * r.ngnPerUsdc) / 1e12;
            netFee         = grossFee > yieldOffset ? grossFee - yieldOffset : 0;
        } else {
            netFee = grossFee;
        }
    }

    function getYieldSummary(bytes32 _dealId)
        external view
        returns (uint256 usycTokens, uint256 originalUSDC, uint256 currentUSDC, uint256 yieldUSDC, uint256 aprBPS)
    {
        CollateralPosition memory pos = positions[_dealId];
        if (pos.collType != CollType.USYC || pos.usycTokens == 0) return (0,0,0,0,0);

        usycTokens   = pos.usycTokens;
        originalUSDC = pos.usdcValueAtLock;
        currentUSDC  = IUSYCVault(usycVault).getRedemptionValue(usycTokens);
        yieldUSDC    = currentUSDC > originalUSDC ? currentUSDC - originalUSDC : 0;

        uint256 daysLocked = (block.timestamp - pos.depositedAt) / 1 days;
        if (daysLocked > 0 && originalUSDC > 0) {
            aprBPS = (yieldUSDC * 10000 * 365) / (originalUSDC * daysLocked);
        }
    }

    function getQuotes   (bytes32 id) external view returns (Quote[]       memory) { return quotes[id];  }
    function getHistory  (bytes32 id) external view returns (Attestation[] memory) { return history[id]; }
    function getPosition (bytes32 id) external view returns (CollateralPosition memory) { return positions[id]; }
    function getRate     (bytes32 id) external view returns (LockedRate memory) { return lockedRates[id]; }
    function getRFQCount ()           external view returns (uint256) { return rfqList.length;  }
    function getDealCount()           external view returns (uint256) { return dealList.length; }

    function getActiveDealIds() external view returns (bytes32[] memory ids) {
        uint256 n; for (uint i; i < dealList.length; i++) if (deals[dealList[i]].status == DealStatus.ACTIVE) n++;
        ids = new bytes32[](n); uint256 j;
        for (uint i; i < dealList.length; i++) if (deals[dealList[i]].status == DealStatus.ACTIVE) ids[j++] = dealList[i];
    }

    // ── Internals ──────────────────────────────────────────────────────────────

    function _executeUSYCRedeem(bytes32 _dealId) internal {
        Deal storage d             = deals[_dealId];
        CollateralPosition storage pos = positions[_dealId];

        uint256 amt    = pos.usycTokens;
        pos.usycTokens = 0;

        IERC20(usycToken).approve(usycVault, amt);
        uint256 usdcOut = IUSYCVault(usycVault).redeem(amt);

        // REPAID → borrower gets principal+yield   LIQUIDATED → lender gets compensation
        address to = d.status == DealStatus.REPAID ? d.borrower : d.lender;
        require(IERC20(usdc).transfer(to, usdcOut), "usdc return failed");
        emit USYCRedeemed(_dealId, to, amt, usdcOut);
    }

    function _releaseUSDCInternal(bytes32 _dealId, address _to) internal {
        CollateralPosition storage pos = positions[_dealId];
        uint256 amt       = pos.usdcDeposited;
        pos.usdcDeposited = 0;
        require(IERC20(usdc).transfer(_to, amt), "usdc release failed");
        emit USDCReleased(_dealId, _to, amt);
    }

    function _doLockRate(bytes32 _dealId) internal {
        (uint256 rate, uint256 updated) = IStableFX(stableFX).getReferenceRate(usdc, NGN_CODE);
        require(rate > 0,                              "zero rate");
        require(block.timestamp - updated < 5 minutes, "stale rate");
        lockedRates[_dealId] = LockedRate({
            ngnPerUsdc: rate,
            lockedAt:   block.timestamp,
            expiresAt:  block.timestamp + 10 minutes,
            active:     true
        });
        emit FXRateLocked(_dealId, rate, block.timestamp + 10 minutes);
    }

    function _healthState(bytes32 _dealId, uint256 hf) internal returns (uint8) {
        if (hf >= 11e17) { marginCallAt[_dealId] = 0; return uint8(HealthState.HEALTHY);  }
        if (hf >= PRECISION)                           return uint8(HealthState.WARNING);
        if (marginCallAt[_dealId] == 0) {
            marginCallAt[_dealId] = block.timestamp;
            emit MarginCall(_dealId, block.timestamp + gracePeriod);
            return uint8(HealthState.MARGIN_CALL);
        }
        if (block.timestamp >= marginCallAt[_dealId] + gracePeriod) return uint8(HealthState.LIQUIDATING);
        return uint8(HealthState.MARGIN_CALL);
    }

    function _recover(bytes32 _hash, bytes calldata _sig) internal pure returns (address) {
        require(_sig.length == 65, "bad sig");
        bytes32 r; bytes32 s; uint8 v;
        assembly {
            r := calldataload(_sig.offset)
            s := calldataload(add(_sig.offset, 32))
            v := byte(0, calldataload(add(_sig.offset, 64)))
        }
        if (v < 27) v += 27;
        return ecrecover(_hash, v, r, s);
    }
}
