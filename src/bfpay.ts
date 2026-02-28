/**
 * BFPay SDK — ethers.js v6 TypeScript
 * Includes: USYC deposit/redeem, StableFX rate lock, yield offset, attestation
 *
 * Install: npm install ethers dotenv
 * Run:     npx ts-node lib/bfpay.ts
 */

import { ethers, Contract, Wallet, JsonRpcProvider, Interface } from "ethers";
import * as dotenv from "dotenv";
import { time } from "console";
dotenv.config();

// ─── ABI ─────────────────────────────────────────────────────────────────────
export const ABI = [
  // Admin
  "function addOracle(address) external",
  "function approveKYB(address) external",
  "function setLTV(uint256) external",
  "function setAddresses(address,address,address,address) external",

  // ── USYC ──
  "function depositUSYC(bytes32 dealId, uint256 usdcAmount) external",
  "function redeemUSYC(bytes32 dealId) external",

  // ── USDC collateral ──
  "function depositUSDCCollateral(bytes32 _dealId, uint256 _amount) external",
  "function releaseUSDC(bytes32 dealId) external",

  // ── StableFX ──
  "function lockFXRate(bytes32 dealId) external",
  "function lockFXRateInternal(bytes32 dealId) external",
  "function getCreditLineNGN(bytes32 dealId) external view returns (uint256)",

  // ── RFQ / Quote / Deal ──
  "function createRFQ(uint256,uint256,uint256,uint8,uint256) external returns (bytes32)",
  "function submitQuote(bytes32,uint256,uint256) external",
  "function acceptQuote(bytes32,uint256) external returns (bytes32)",

  // ── Settlement ──
  "function confirmPayout(bytes32,string) external",
  "function confirmRepayment(bytes32,string) external",

  // ── Oracle ──
  "function attest(bytes32,uint256,uint256,uint256,uint256,bytes) external",

  // ── Views ──
  "function calculateFee(bytes32) external view returns (uint256 gross, uint256 yieldOffset, uint256 net, uint256 days)",
  "function getYieldSummary(bytes32) external view returns (uint256 tokens, uint256 originalUSDC, uint256 currentUSDC, uint256 yieldUSDC, uint256 aprBPS)",
  "function getCreditLineNGN(bytes32) external view returns (uint256)",
  "function getQuotes(bytes32) external view returns (tuple(bytes32,address,uint256,uint256,bool)[])",
  "function getHistory(bytes32) external view returns (tuple(bytes32,uint256,uint256,uint256,uint256,uint256,uint8,uint256,address)[])",
  "function getPosition(bytes32) external view returns (tuple(uint8,uint256,uint256,uint256,uint256))",
  "function getRate(bytes32) external view returns (tuple(uint256,uint256,uint256,bool))",
  "function getActiveDealIds() external view returns (bytes32[])",
  "function getRFQCount() external view returns (uint256)",
  "function getDealCount() external view returns (uint256)",
  "function deals(bytes32) external view returns (bytes32,bytes32,address,address,uint256,uint256,uint256,uint256,uint256,uint256,uint8,uint8,uint8,string,string)",
  "function rfqs(bytes32) external view returns (bytes32,address,uint256,uint256,uint256,uint8,uint256,uint256,bool)",
  "function oracleNonce(address) external view returns (uint256)",
  "function isKYB(address) external view returns (bool)",

  // ── Events ──
  "event USYCDeposited(bytes32 indexed dealId, uint256 usycTokens, uint256 usdcIn)",
  "event USYCRedeemed(bytes32 indexed dealId, address recipient, uint256 usycTokens, uint256 usdcOut)",
  "event USDCDeposited(bytes32 indexed dealId, uint256 amount)",
  "event USDCReleased(bytes32 indexed dealId, address recipient, uint256 amount)",
  "event FXRateLocked(bytes32 indexed dealId, uint256 ngnPerUsdc, uint256 expiresAt)",
  "event YieldOffset(bytes32 indexed dealId, uint256 yieldUSDC, uint256 yieldNGN, uint256 netFeeNGN)",
  "event RFQCreated(bytes32 indexed id, address borrower, uint256 amountNGN, uint8 collType)",
  "event QuoteSubmitted(bytes32 indexed rfqId, address lender, uint256 feeBPS)",
  "event DealOpened(bytes32 indexed dealId, address borrower, address lender)",
  "event PayoutConfirmed(bytes32 indexed dealId, string fiatRef)",
  "event Repaid(bytes32 indexed dealId, string fiatRef)",
  "event Attested(bytes32 indexed dealId, uint256 healthFactor, uint8 state)",
  "event MarginCall(bytes32 indexed dealId, uint256 endsAt)",
  "event Liquidated(bytes32 indexed dealId)",
];

// Also need ERC-20 ABI for USDC approval
export const ERC20_ABI = [
  "function approve(address spender, uint256 amount) external returns (bool)",
  "function allowance(address owner, address spender) external view returns (uint256)",
  "function balanceOf(address) external view returns (uint256)",
];

// ─── Helpers ──────────────────────────────────────────────────────────────────
export const CollTypeName: Record<number, string> = {
  0: "USYC", 1: "USDC", 2: "GBP Fiat", 3: "USD Fiat", 4: "EUR Fiat",
};
export const HealthName: Record<number, string> = {
  0: "HEALTHY", 1: "WARNING", 2: "MARGIN CALL", 3: "LIQUIDATING",
};
export const StatusName: Record<number, string> = {
  0: "OPEN", 1: "MATCHED", 2: "ACTIVE", 3: "REPAID", 4: "LIQUIDATED",
};

const fmt6  = (n: bigint) => (Number(n) / 1e6).toLocaleString("en", { minimumFractionDigits: 2 });
const fmt18 = (n: bigint) => ethers.formatEther(n);

// ─── Client ───────────────────────────────────────────────────────────────────
export class BFPayClient {
  contract:  Contract;
  signer:    Wallet;
  iface:     Interface;

  constructor(contractAddr: string, privateKey: string, rpcUrl: string) {
    const provider   = new JsonRpcProvider(rpcUrl);
    this.signer      = new Wallet(privateKey, provider);
    this.contract    = new Contract(contractAddr, ABI, this.signer);
    this.iface       = new Interface(ABI);
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // USYC DEPOSIT
  // Converts USDC → USYC via Hashnote vault, locks in contract as collateral
  // Borrower must first approve the BFPay contract to spend their USDC
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Step 1: Approve BFPay contract to pull USDC
   * @param usdcAddress   USDC contract address
   * @param usdcAmount    Amount in USDC base units (6 dec) e.g. 100_000n * BigInt(1e6)
   */
  async approveUSDC(usdcAddress: string, usdcAmount: bigint,contractAddress: string): Promise<string> {
    const usdc = new Contract(usdcAddress, ERC20_ABI, this.signer);
    console.log( usdcAddress + `[USDC] Approving $${fmt6(usdcAmount)} USDC for BFPay...`);
    const tx = await usdc.approve(await contractAddress, usdcAmount);
    await tx.wait();
    console.log(`[USDC] ✅ Approved | tx: ${tx.hash}`);
    return tx.hash;
  }

  /**
   * Step 2: Deposit USDC → auto-converted to USYC collateral
   * @param dealId        The matched deal to back
   * @param usdcAmount    USDC amount (6 dec) — must have approved first
   *
   * What happens onchain:
   *   1. BFPay pulls USDC from borrower
   *   2. BFPay calls IUSYCVault.subscribe(usdcAmount) → gets USYC
   *   3. USYC stays in BFPay contract, tracked per deal
   *   4. USYC earns ~5% APY → offsets daily borrowing fee
   */
  async depositUSYC(usdcAddress: string, rpcUrl:string, key:string,contractAddress: string, dealId: string, usdcAmount: bigint): Promise<string> {
    console.log(`\n[USYC Deposit] Deal: ${dealId.slice(0,12)}...`);
    console.log(`[USYC Deposit] USDC in: $${fmt6(usdcAmount)}`);
    const provider   = new JsonRpcProvider(rpcUrl);
    const wallet = new Wallet(key, provider);

     const usdc = new Contract(usdcAddress, ERC20_ABI, wallet);
    console.log( usdcAddress + `[USDC] Approving $${fmt6(usdcAmount)} USDC for BFPay...`);
    const tx1 = await usdc.approve(await contractAddress, usdcAmount);
    //await sleep(2000);
    await tx1.wait();
    console.log(`[USDC] ✅ Approved | tx: ${tx1.hash}`);

    const lendContractAdr = new Contract(contractAddress, ABI, wallet);

    const deal = await lendContractAdr.deals(dealId);
    console.log(deal);
    const isKYB = await lendContractAdr.isKYB(wallet.address); 
    console.log('is kyb ' + isKYB);

   /* try {
    await lendContractAdr.depositUSYC.staticCall(dealId, usdcAmount);
  } catch (e) {
    console.error("Revert reason:", e);
  }*/

    const tx = await lendContractAdr.depositUSYC(dealId, usdcAmount, { gasLimit: 350_000 });
    const receipt = await tx.wait();
    console.log(`[USYC Deposit] USDC pulled and converted to USYC collateral | tx: ${tx.hash}`);
    console.log(receipt);
;    // Parse USYCDeposited event
    const log    = receipt.logs.find((l: any) => {
      try { return this.iface.parseLog(l)?.name === "USYCDeposited"; } catch { return false; }
    });
    const parsed = log ? this.iface.parseLog(log) : null;

    if (parsed) {
      const usycTokens = parsed.args.usycTokens as bigint;
      console.log(`[USYC Deposit] ✅ USYC minted: ${ethers.formatUnits(usycTokens, 18)}`);
      console.log(`[USYC Deposit] Yield accrual started — collateral is now earning`);
    }
    console.log(`[USYC Deposit] tx: ${tx.hash}`);
    return tx.hash;
  }

  /**
   * Redeem USYC → USDC+yield, return to borrower (usually auto-triggered)
   * Only callable after deal is REPAID or LIQUIDATED
   */
  async redeemUSYC(dealId: string): Promise<string> {
    console.log(`\n[USYC Redeem] Redeeming for deal ${dealId.slice(0,12)}...`);

    const tx      = await this.contract.redeemUSYC(dealId, { gasLimit: 300_000 });
    const receipt = await tx.wait();

    const log    = receipt.logs.find((l: any) => {
      try { return this.iface.parseLog(l)?.name === "USYCRedeemed"; } catch { return false; }
    });
    if (log) {
      const parsed = this.iface.parseLog(log)!;
      const usdcOut = parsed.args.usdcOut as bigint;
      console.log(`[USYC Redeem] ✅ USDC returned: $${fmt6(usdcOut)} (includes yield)`);
    }
    return tx.hash;
  }

  /**
   * Read current USYC yield summary for a deal
   */
  async getYieldSummary(dealId: string) {
    const r = await this.contract.getYieldSummary(dealId);
    const originalUSDC = r[1] as bigint;
    const currentUSDC  = r[2] as bigint;
    const yieldUSDC    = r[3] as bigint;
    const aprBPS       = r[4] as bigint;

    const summary = {
      usycTokens:    ethers.formatUnits(r[0] as bigint, 18),
      originalUSDC:  `$${fmt6(originalUSDC)}`,
      currentUSDC:   `$${fmt6(currentUSDC)}`,
      yieldEarned:   `$${fmt6(yieldUSDC)}`,
      effectiveAPR:  `${(Number(aprBPS) / 100).toFixed(2)}%`,
    };

    console.log(`\n[USYC Yield Summary]`);
    console.log(`  Original deposit:  ${summary.originalUSDC}`);
    console.log(`  Current value:     ${summary.currentUSDC}`);
    console.log(`  Yield accrued:     ${summary.yieldEarned}`);
    console.log(`  Effective APR:     ${summary.effectiveAPR}`);
    return summary;
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // USDC COLLATERAL (no yield — raw USDC locked)
  // ═══════════════════════════════════════════════════════════════════════════

  async depositUSDC(dealId: string, usdcAmount: bigint): Promise<string> {
    console.log(`[USDC Collateral] Depositing $${fmt6(usdcAmount)}...`);
    const tx = await this.contract.depositUSDC(dealId, usdcAmount, { gasLimit: 200_000 });
    await tx.wait();
    console.log(`[USDC Collateral] ✅ Locked | tx: ${tx.hash}`);
    return tx.hash;
  }

  async releaseUSDC(dealId: string): Promise<string> {
    console.log(`[USDC Release] Releasing USDC for deal ${dealId.slice(0,12)}...`);
    const tx = await this.contract.releaseUSDC(dealId, { gasLimit: 150_000 });
    await tx.wait();
    console.log(`[USDC Release] ✅ Released | tx: ${tx.hash}`);
    return tx.hash;
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // STABLEFX RATE LOCK
  // Queries Circle StableFX for live USDC/NGN rate, locks it onchain
  // Rate is used to compute credit line and yield offset in NGN terms
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Lock StableFX rate for a deal.
   * Usually auto-called inside acceptQuote() — call manually if auto-lock failed.
   */
  async lockFXRate(dealId: string): Promise<string> {
    console.log(`\n[StableFX] Locking USDC/NGN rate for deal ${dealId.slice(0,12)}...`);
    const tx      = await this.contract.lockFXRate(dealId, { gasLimit: 200_000 });
    const receipt = await tx.wait();

    const log = receipt.logs.find((l: any) => {
      try { return this.iface.parseLog(l)?.name === "FXRateLocked"; } catch { return false; }
    });
    if (log) {
      const parsed = this.iface.parseLog(log)!;
      const rate   = parsed.args.ngnPerUsdc as bigint;
      // rate is NGN × 1e6 per 1 USDC
      const humanRate = (Number(rate) / 1e6).toLocaleString("en", { maximumFractionDigits: 2 });
      console.log(`[StableFX] ✅ Rate locked: ₦${humanRate} per $1 USDC`);
      console.log(`[StableFX] Valid until: ${new Date(Number(parsed.args.expiresAt) * 1000).toISOString()}`);
    }
    return tx.hash;
  }

  /**
   * Read the locked NGN credit line for a deal
   */
  async getCreditLineNGN(dealId: string): Promise<string> {
    const creditNGN: bigint = await this.contract.getCreditLineNGN(dealId);
    const humanNGN = Number(creditNGN).toLocaleString("en");
    console.log(`[Credit Line] ₦${humanNGN} available for deal ${dealId.slice(0,12)}`);
    return humanNGN;
  }

  /**
   * Read the locked StableFX rate
   */
  async getLockedRate(dealId: string) {
    const r = await this.contract.getRate(dealId);
    if (!r[3]) return null;
    const rate = {
      ngnPerUsdc: (Number(r[0] as bigint) / 1e6).toFixed(2),
      lockedAt:   new Date(Number(r[1]) * 1000).toISOString(),
      expiresAt:  new Date(Number(r[2]) * 1000).toISOString(),
      active:     r[3] as boolean,
    };
    console.log(`[Locked Rate] ₦${rate.ngnPerUsdc} / USDC locked at ${rate.lockedAt}`);
    return rate;
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // RFQ → QUOTE → DEAL (unchanged but shown for completeness)
  // ═══════════════════════════════════════════════════════════════════════════

  async createRFQ(
    amountNGN:    bigint,
    tenorDays:    number,
    maxFeeBPS:    number,
    collType:     0|1|2|3|4,
    collateralUSD: bigint       // USD × 1e6
  ): Promise<string> {

    console.log('coll type ' + collType + ' ' + collateralUSD + ' ' + amountNGN);
    console.log(`\n[RFQ] Creating: ₦${Number(amountNGN).toLocaleString()} | ${tenorDays}d | ${CollTypeName[collType]} collateral`);
    const tx = await this.contract.createRFQ(amountNGN, tenorDays, maxFeeBPS, collType, collateralUSD);
    const receipt = await tx.wait();

    const log    = receipt.logs.find((l: any) => { try { return this.iface.parseLog(l)?.name === "RFQCreated"; } catch { return false; } });
    const rfqId  = log ? (this.iface.parseLog(log)!.args.id as string) : "unknown";
    console.log(`[RFQ] ✅ Created | id: ${rfqId}`);
    return rfqId;
  }

  async submitQuote(rfqId: string, feeBPS: number, validSecs = 120): Promise<string> {
    console.log(`[Quote] Submitting ${feeBPS/100}%/day for RFQ ${rfqId.slice(0,12)}...`);
    const tx = await this.contract.submitQuote(rfqId, feeBPS, validSecs);
    await tx.wait();
    console.log(`[Quote] ✅ Submitted`);
    return tx.hash;
  }

  async acceptQuote(rfqId: string, idx: number): Promise<string> {
    console.log(`[Deal] Accepting quote #${idx}...`);
    const tx      = await this.contract.acceptQuote(rfqId, idx);
    const receipt = await tx.wait();

    const log    = receipt.logs.find((l: any) => { try { return this.iface.parseLog(l)?.name === "DealOpened"; } catch { return false; } });
    const dealId = log ? (this.iface.parseLog(log)!.args.dealId as string) : "unknown";

    // Check if StableFX rate was auto-locked
    const rateLocked = receipt.logs.some((l: any) => { try { return this.iface.parseLog(l)?.name === "FXRateLocked"; } catch { return false; } });
    console.log(`[Deal] ✅ Opened | id: ${dealId}`);
    console.log(`[Deal] StableFX rate auto-locked: ${rateLocked ? "✅ YES" : "⚠️ NO — call lockFXRate() manually"}`);
    return dealId;
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // SETTLEMENT
  // ═══════════════════════════════════════════════════════════════════════════

  async confirmPayout(dealId: string, fiatRef: string): Promise<string> {
    console.log(`[Payout] Confirming ${dealId.slice(0,12)} | ref: ${fiatRef}`);
    const tx = await this.contract.confirmPayout(dealId, fiatRef);
    await tx.wait();
    console.log(`[Payout] ✅ NGN payout confirmed`);
    return tx.hash;
  }

  /**
   * Confirm repayment — automatically redeems USYC+yield back to borrower
   */
  async confirmRepayment(dealId: string, fiatRef: string): Promise<string> {
    console.log(`\n[Repayment] Confirming ${dealId.slice(0,12)} | ref: ${fiatRef}`);
    const tx      = await this.contract.confirmRepayment(dealId, fiatRef);
    const receipt = await tx.wait();

    // Check for auto-redeem events
    const usycRedeemed = receipt.logs.find((l: any) => { try { return this.iface.parseLog(l)?.name === "USYCRedeemed"; } catch { return false; } });
    const usdcReleased = receipt.logs.find((l: any) => { try { return this.iface.parseLog(l)?.name === "USDCReleased"; } catch { return false; } });
    const yieldOff     = receipt.logs.find((l: any) => { try { return this.iface.parseLog(l)?.name === "YieldOffset";  } catch { return false; } });

    if (usycRedeemed) {
      const p = this.iface.parseLog(usycRedeemed)!;
      console.log(`[Repayment] ✅ USYC redeemed → $${fmt6(p.args.usdcOut as bigint)} USDC returned to borrower`);
    }
    if (usdcReleased) {
      const p = this.iface.parseLog(usdcReleased)!;
      console.log(`[Repayment] ✅ USDC released → $${fmt6(p.args.amount as bigint)} returned`);
    }
    if (yieldOff) {
      const p = this.iface.parseLog(yieldOff)!;
      console.log(`[Yield Offset] Yield: $${fmt6(p.args.yieldUSDC as bigint)} USDC`);
      console.log(`[Yield Offset] Offset: ₦${Number(p.args.yieldNGN as bigint).toLocaleString()}`);
      console.log(`[Yield Offset] Net fee owed: ₦${Number(p.args.netFeeNGN as bigint).toLocaleString()}`);
    }
    console.log(`[Repayment] tx: ${tx.hash}`);
    return tx.hash;
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // ORACLE ATTESTATION
  // ═══════════════════════════════════════════════════════════════════════════

  async attest(
    dealId:       string,
    collateralUSD: bigint,   // USD × 1e6 (for fiat deals; USYC uses vault price)
    drawnNGN:     bigint,    // whole NGN
    ngnUsdRate:   bigint     // NGN per USD × 1e6 (live rate)
  ): Promise<string> {
    const nonce   = await this.contract.oracleNonce(this.signer.address) as bigint;
    const chainId = (await this.signer.provider!.getNetwork()).chainId;

    const dataHash = ethers.keccak256(ethers.AbiCoder.defaultAbiCoder().encode(
      ["bytes32","uint256","uint256","uint256","uint256","uint256"],
      [dealId, collateralUSD, drawnNGN, ngnUsdRate, nonce, chainId]
    ));
    const msgHash = ethers.keccak256(ethers.concat([
      ethers.toUtf8Bytes("\x19Ethereum Signed Message:\n32"),
      dataHash,
    ]));
    const sig = ethers.Signature.from(
      await this.signer.signingKey.sign(ethers.getBytes(msgHash))
    ).serialized;

    console.log(`\n[Attest] Pushing health factor for ${dealId.slice(0,12)}...`);
    const tx      = await this.contract.attest(dealId, collateralUSD, drawnNGN, ngnUsdRate, nonce, sig, { gasLimit: 400_000 });
    const receipt = await tx.wait();

    const attLog = receipt.logs.find((l: any) => { try { return this.iface.parseLog(l)?.name === "Attested"; } catch { return false; } });
    if (attLog) {
      const p  = this.iface.parseLog(attLog)!;
      const hf = Number(p.args.healthFactor as bigint) / 1e18;
      const st = HealthName[Number(p.args.state)];
      console.log(`[Attest] ✅ HF: ${hf.toFixed(4)} | State: ${st}`);
    }
    return tx.hash;
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // FEE CALCULATION WITH YIELD OFFSET
  // ═══════════════════════════════════════════════════════════════════════════

  async calculateFee(dealId: string) {
    const r = await this.contract.calculateFee(dealId);
    const result = {
      grossFeeNGN:   Number(r[0] as bigint).toLocaleString(),
      yieldOffsetNGN: Number(r[1] as bigint).toLocaleString(),
      netFeeNGN:     Number(r[2] as bigint).toLocaleString(),
      daysElapsed:   Number(r[3] as bigint),
    };
    console.log(`\n[Fee Breakdown]`);
    console.log(`  Gross fee:     ₦${result.grossFeeNGN}`);
    console.log(`  Yield offset:  ₦${result.yieldOffsetNGN} (from USYC accrual)`);
    console.log(`  Net fee owed:  ₦${result.netFeeNGN}`);
    console.log(`  Days elapsed:  ${result.daysElapsed}`);
    return result;
  }

  // ── Admin helpers ──────────────────────────────────────────────────────────
  async approveKYB(user: string)   { const tx = await this.contract.approveKYB(user); await tx.wait(); console.log(`✅ KYB: ${user}`); }
  async addOracle(oracle: string)  { const tx = await this.contract.addOracle(oracle); await tx.wait(); console.log(`✅ Oracle: ${oracle}`); }

  // ═══════════════════════════════════════════════════════════════════════════
  // DEMO — full USYC + StableFX lifecycle
  // ═══════════════════════════════════════════════════════════════════════════

  static async runDemo() {
    const RPC         = process.env.RPC_URL       ?? "";
    const CONTRACT    = process.env.CONTRACT       ?? "";
    const USDC_ADDR   = process.env.USDC_ADDRESS   ?? "";
    const OWNER_PK    = process.env.OWNER_PK       ?? "";
    const LENDER_PK   = process.env.LENDER_PK      ?? "";
    const BORROWER_PK = process.env.BORROWER_PK    ?? "";

    const owner    = new BFPayClient(CONTRACT, OWNER_PK, RPC);
    const lender   = new BFPayClient(CONTRACT, LENDER_PK, RPC);
    const borrower = new BFPayClient(CONTRACT, BORROWER_PK, RPC);

    console.log("\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
    console.log("  BFPay — Full USYC + StableFX Demo  ");
    console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n");

    // 1. Setup
    //await owner.approveKYB(lender.signer.address);
    //await owner.approveKYB(borrower.signer.address);
    //await owner.addOracle(owner.signer.address);

    // 2. Borrower creates RFQ: ₦50M, 7 days, USYC collateral, $100K USD
    /*const rfqId = await borrower.createRFQ(
      BigInt("50000000"),          // ₦50M
      7, 20,                // 7 days, max 0.20%/day
      0,                    // CollType.USYC
      BigInt(100000) * BigInt(1000000) // $100,000 USD in 1e6
    );*/
    const rfqId = "0x602afc892ecc39ea4bc25ca5fd68a4c38c249a934d1e86b36be47e10164a8eb5"; // placeholder if RFQ creation is skipped

    // 3. Lender quotes 0.15%/day
   // await lender.submitQuote(rfqId, 15, 300);

    // 4. Borrower accepts — StableFX rate auto-locked inside
    const dealId = '0xbab289772fa1a5c2d3146084d040cbdd5a4fbaa72e4716ae40120a4757a6c503';
    // await borrower.acceptQuote(rfqId, 0);

    // 5. Borrower approves USDC then deposits → auto-converts to USYC
    //await borrower.approveUSDC(USDC_ADDR, BigInt(100000) * BigInt(1000000));
    await borrower.depositUSYC(USDC_ADDR,RPC, BORROWER_PK, CONTRACT, dealId, BigInt(5) * BigInt(1000000));
    
      
    // 6. Read locked rate and credit line
    await borrower.getLockedRate(dealId);
    await borrower.getCreditLineNGN(dealId);

    // 7. Oracle confirms NGN payout sent via fiat partner
    await owner.confirmPayout(dealId, "FP-TXN-0001");

    // 8. Oracle attests health factor (60s polling loop in production)
    await owner.attest(
      dealId,
      BigInt(5) * BigInt(1000000), // $100K collateral (USD × 1e6)
      BigInt(5000),            // ₦50M drawn (whole NGN)
      BigInt(1370000)          // ₦1,580 per $1 (× 1e6)
    );

    // 9. Check yield and fee after some time
    await borrower.getYieldSummary(dealId);
    await borrower.calculateFee(dealId);

    // 10. Oracle confirms repayment — USYC auto-redeemed + yield returned
    await owner.confirmRepayment(dealId, "FP-REPAY-0001");

    console.log("\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
    console.log("  Demo complete ✅");
    console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n");
  }
}

if (require.main === module) {
  BFPayClient.runDemo().catch(console.error);
}
function sleep(arg0: number) {
  throw new Error("Function not implemented.");
}

