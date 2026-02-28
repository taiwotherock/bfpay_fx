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

// Minimal ERC20 ABI
const ERC20_ABI = [
  "function balanceOf(address owner) view returns (uint256)",
  "function approve(address spender, uint256 amount) public returns (bool)",
  "function allowance(address owner, address spender) external",
  "function decimals() view returns (uint8)"
];


export async function usycDeposit(
  key: string,
  tokenAddress: string,
  rpcUrl: string,
  contractAddress: string,
  usyContractAddress: string,
  amount: string

) {
  try {
    const provider = new ethers.JsonRpcProvider(rpcUrl);
    const wallet = new ethers.Wallet(key, provider);
    
    // Get actual chain ID from the network
    const network = await provider.getNetwork();
   
    console.log('=== NETWORK INFO ===');
    console.log('Network name:', network.name);
    console.log('Chain ID:', network.chainId);
  
    const contract = new ethers.Contract(contractAddress, USYC_TELLER_ABI, wallet);
    const publicAddress = await wallet.getAddress();

    console.log('\n=== WALLET INFO ===');
    console.log('Public address:', publicAddress);
    console.log('Contract address:', contractAddress);

    const usdtAddress = ethers.getAddress(tokenAddress);
    const usdtContract = new ethers.Contract(usdtAddress, ERC20_ABI, wallet);
    const decimalNo = await usdtContract.decimals();

    const amountInt = ethers.parseUnits(amount, decimalNo);
    console.log(`\nApproving ${amount} USDT for deposit...`);
    const approveTx = await usdtContract.approve(contractAddress, amountInt);
    console.log('⏳ Approval transaction hash:', approveTx.hash);
    await approveTx.wait();
    console.log('✅ Approval confirmed.');

    const tx = await contract.deposit(amountInt, publicAddress);
    console.log("⏳ Transaction hash:", tx.hash);
    await tx.wait();
    console.log('\n✅ Tx deposited at:', tx);

    const usycAddress = ethers.getAddress(usyContractAddress);
    const usycContract = new ethers.Contract(usycAddress, ERC20_ABI, wallet);
    const usycBalance = await usycContract.balanceOf(publicAddress);
    console.log('USYC balance:', usycBalance);

    return { success: true, message: 'SUCCESS', txId: tx.hash, code: '000' };

  } catch (error: any) {
    console.error('\n❌ ERROR:', error.message);
    return { 
      message: error.message || 'Transaction failed', 
      txId: '', 
      code: 'E999' 
    };
  }
}

