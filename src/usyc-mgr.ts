import { ethers } from "ethers";
import { Wallet, JsonRpcProvider, Contract, keccak256, toUtf8Bytes } from "ethers";
import dotenv from 'dotenv';


dotenv.config();

// ====== ABI (minimal) ======
const ABI = [

  "function deployWalletForCustomer(string memory customerId, address owner, uint256 dailyLimit, uint256 maxTxAmount, address guardian) external returns (address wallet)",
  "function predictWalletAddress(string memory customerId) external view returns (address predicted)",
  "function getWallet(string memory customerId) external view returns (address)"

  ];

const USYC_TELLER_ABI = [
  "function deposit(uint256 _assets, address _receiver) returns (uint256)",
  "function redeem(uint256 _amount, address _receiver, address _account) returns (uint256)",
] ;
