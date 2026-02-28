# BFPay — How to Run

## Project Structure
```
bfpay/
  contracts/BFPay.sol        ← Solidity smart contract
  lib/bfpay.ts               ← Ethers.js TypeScript SDK
  dashboard/index.html       ← Full UI dashboard
```

## 1. Deploy the Contract (Hardhat or Foundry)

### Foundry
```bash
forge init && cp contracts/BFPay.sol src/BFPay.sol
forge build
forge create src/BFPay.sol:BFPay --rpc-url $RPC_URL --private-key $PK
```

### Hardhat
```bash
npx hardhat compile
npx hardhat run scripts/deploy.js --network base_sepolia
```

## 2. Run the TypeScript SDK

```bash
npm init -y
npm install ethers dotenv ts-node typescript

# Create .env
echo "RPC_URL=https://base-sepolia.g.alchemy.com/v2/YOUR_KEY" >> .env
echo "CONTRACT=0xYourDeployedAddress" >> .env
echo "OWNER_PK=0x..." >> .env
echo "LENDER_PK=0x..." >> .env
echo "BORROWER_PK=0x..." >> .env

# Run full lifecycle demo
npx ts-node lib/bfpay.ts
```

## 3. Individual Function Usage

```typescript
import { BFPayClient } from './lib/bfpay';
import { ethers } from 'ethers';

const client = new BFPayClient(
  process.env.CONTRACT!,
  process.env.OWNER_PK!,
  process.env.RPC_URL!
);

// KYB approve a user
await client.approveKYB("0xUserAddress");

// Create RFQ: ₦50M, 7 days, max 0.20%/day, USYC, $100K collateral
const rfqId = await client.createRFQ(
  50_000_000n,
  7, 20, 0,
  ethers.parseEther("100000")
);

// Submit quote: 0.15%/day, valid 2 minutes
await client.submitQuote(rfqId, 15, 120);

// Accept quote index 0
const dealId = await client.acceptQuote(rfqId, 0);

// Confirm NGN payout
await client.confirmPayout(dealId, "FP-TXN-001");

// Attest health factor
await client.attest(
  dealId,
  ethers.parseEther("100000"),   // $100K collateral
  ethers.parseEther("50000000"), // ₦50M drawn
  ethers.parseEther("1580")      // ₦1580 per USD
);

// Read deal
const deal = await client.getDeal(dealId);
console.log(deal);
// → { healthFactor: '1.6200', healthState: 'HEALTHY', status: 'ACTIVE', ... }

// Confirm repayment
await client.confirmRepayment(dealId, "FP-REPAY-001");
```

## 4. Open Dashboard

```bash
# Just open in browser — no server needed
open dashboard/index.html

# Or serve it
npx serve dashboard/
```

## Networks
| Network | RPC |
|---|---|
| Base Sepolia (testnet) | https://sepolia.base.org |
| Base Mainnet | https://mainnet.base.org |
| Hardhat Local | http://127.0.0.1:8545 |
