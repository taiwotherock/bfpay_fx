
import dotenv from 'dotenv';
//import forge from "node-forge";
//import { insertData, insertTranData } from './save-wallet';

import { registerEntitySecretCiphertext } from '@circle-fin/developer-controlled-wallets'
import { initiateDeveloperControlledWalletsClient,Blockchain } from '@circle-fin/developer-controlled-wallets';

import { generateEntitySecret } from '@circle-fin/developer-controlled-wallets'
// This will print a new entity secret in the terminal
//generateEntitySecret()
dotenv.config();


type Wallet = {
  id: string;
  address: string;
  blockchain: string;
  state: string;
};

export async function initWallet () {

    //generateEntitySecret()

    //console.log(process.env.CRC_SECRET_CYPHER)
    
    const client = initiateDeveloperControlledWalletsClient({
    apiKey: process.env.CRC_API_KEY!,
    entitySecret: process.env.CRC_ENTITY_SECRET!
    });

    const responsew = await client.createWalletSet({
      name: 'Customer Wallet 1'
  });

  console.log(responsew);
  const walletId=responsew.data?.walletSet.id
  console.log('id: ' + walletId)

    
    

}

export async function createWallet (name: string, walletSetId: string,chain: string) {
  
  const client = initiateDeveloperControlledWalletsClient({
  apiKey: process.env.CRC_API_KEY!,
  entitySecret: process.env.CRC_ENTITY_SECRET!
  });


  if(walletSetId == '')
  {
    const responsew = await client.createWalletSet({
      name: name
    });
    //console.log(responsew);
     walletSetId=responsew.data?.walletSet.id!
  }

  console.log('wallet sett id: ' + walletSetId + ' ' + chain)
  //var chains = JSON.parse("[" + chain + "]");
  //type Blockchain = "MATIC-AMOY" | "ETH-SEPOLIA" | "BTC-TESTNET";
  var chains = chain as Blockchain

  //
  console.log('about to create wallet ' );
  const response = await client.createWallets({
    accountType: "SCA",
    blockchains: [chains],
    count: 1,
    walletSetId: walletSetId,
  });

  console.log(response)
  if(response.status == 201)
  {
    console.log('wallet address ' + response.data!.wallets[0].address); 
    console.log('wallet id ' + response.data!.wallets[0].id); 
    return {success:true, id: response.data!.wallets[0].id, privateKey: response.data!.wallets[0].address,
       address: response.data!.wallets[0].address,
    chain: response.data!.wallets[0].blockchain, phrase: walletSetId};
  }

  return {success:false, id: '', address: '',
    chain: '', phrase: ''};

}

export async function fetchBalanceUSDC (walletId: string) {
  
  const client = initiateDeveloperControlledWalletsClient({
  apiKey: process.env.CRC_API_KEY!,
  entitySecret: process.env.CRC_ENTITY_SECRET!
  });

  const response = await client.getWalletTokenBalance({
    id: walletId,
  });

  console.log(response)
  if(response.status == 200 )
  {
    if(response.data!.tokenBalances!.length > 0)
    {
      console.log('wallet balance ' + response.data!.tokenBalances![0].amount); 
      console.log('wallet id ' + response.data!.tokenBalances![0].token.id); 
      var response2 = {success:true, balance: response.data!.tokenBalances![0].amount, symbol: 'USDC',
      id: response.data!.tokenBalances![0].token.id };
      return response2;
    }
    else
      {
        return {success:true, balance: 0, symbol: 'USDC', id: '' };
      }
  }

  return {success:false, balance: 0, symbol: 'USDC', id: '' };

}

export async function transferUSDC (sourceWalletId: string, beneficiaryWalletId: string,
  amount: string, sourceTokenId: string, externalRef: string,chain:string) {
  
  const client = initiateDeveloperControlledWalletsClient({
  apiKey: process.env.CRC_API_KEY!,
  entitySecret: process.env.CRC_ENTITY_SECRET!
  });

  const response = await client.createTransaction({
    walletId: sourceWalletId,
    tokenId: sourceTokenId,
    destinationAddress: beneficiaryWalletId,
    amount: [amount],
    fee: {
      type: 'level',
      config: {
        feeLevel: 'HIGH'
      }
    }
  });

  console.log(response);
  const txId = response.data!.id

  console.log('txtId ' + txId)
  //data: { id: '55b469eb-2c01-523d-8016-121cdee4dfd4', state: 'INITIATED' },
  //insertTranData(externalRef ,txId, chain);

  var response2 = {success: true, responseCode: 'PP', responseMessage: '', txId: txId, blockNumber: '',
  blockTimeStamp: '', status: response.data!.state };

  for (let i = 0; i < 4; i++) {
    try {
      console.log(`Iteration ${i + 1} started`);
      if (i < 4) { // avoid sleeping after last iteration
        console.log("Sleeping for 5 seconds...");
        await sleep(5000);

         var responset = await transferQueryUSDC (txId,'USDC') 
         if(responset != null && responset.success)
            return responset;
      }
    }
    catch(error)
    {
      console.log(error)
    }
  } //for


  return response2;

  
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

export async function transferQueryUSDC (txId: string, symbol:string) {
  
  const client = initiateDeveloperControlledWalletsClient({
  apiKey: process.env.CRC_API_KEY!,
  entitySecret: process.env.CRC_ENTITY_SECRET!
  });

  console.log('txt query status ' + txId)

  const response = await client.getTransaction({
    id: txId,
  })
  console.log(response.data?.transaction)
  console.log(response.data?.transaction!.operation)

  if(response.data?.transaction!.operation == 'TRANSFER')
  {
     var status2 = '';
    var statux = response.data?.transaction.state.toString();
    if(statux == 'COMPLETE' || statux == 'CONFIRMED')
        statux = 'SUCCESS';
        console.log('statusx ' + statux)
    return {success:true,chain: response.data?.transaction.blockchain,
     txId: txId, fee:response.data?.transaction.networkFee,
      toAddress: response.data?.transaction.destinationAddress,
     fromAddress: response.data?.transaction.sourceAddress,
     blockRefNo: response.data?.transaction.txHash,
     symbol: symbol,
     amount: response.data?.transaction.amounts![0]!, blockNumber: response.data?.transaction.blockHeight,
     blockTimestamp: response.data?.transaction.firstConfirmDate,
     contractAddress: response.data?.transaction.walletId, crDr:'',status: statux };
  }

  return null;
  
}

//initWallet();
var wx  = createWallet("Merchant Wallet","f2d68602-382c-5eca-a719-fe40ac77d234","ARC-TESTNET")
//fetchBalance('ebe05c72-2884-5c68-85e2-bd61aada7a80')
////fetchBalance('b79f7bf5-fbc8-5f88-ab6b-aa6cd41d56c7')
//transfer('ebe05c72-2884-5c68-85e2-bd61aada7a80','0xee8306a02e59b4527dc3fda555c5e40d61b29a73',0.1,'bdf128b4-827b-5267-8f9e-243694989b5f');
//console.log(transferQuery('55b469eb-2c01-523d-8016-121cdee4dfd4'))
0x3fece74e9fc392c3b6e2b0528c01f4f8c89028b1f5543121e2609ab3a4ae1e94

