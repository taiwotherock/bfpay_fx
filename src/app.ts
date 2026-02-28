import express from 'express';
import cors from 'cors'
import dotenv from 'dotenv';
import path from 'path';
import {usycDeposit} from './usyc-mgr'
import { BFPayClient } from './bfpay';
import { ethers } from 'ethers';




dotenv.config();
const PORT = process.env.PORT;
//const API_KEY = process.env.API_KEY
//const ACCESS_TOKEN = process.env.ACCESS_TOKEN
const origins = process.env.CORS_ORIGIN

const app = express();
app.use(express.json())
app.use(cors());
app.use(express.static(path.join(__dirname, '..', 'public')));

const provider = new ethers.JsonRpcProvider(process.env.RPC_URL);
const wallet   = new ethers.Wallet(process.env.PRIVATE_KEY!, provider);
const client   = new BFPayClient(process.env.CONTRACT!, process.env.PRIVATE_KEY!, process.env.RPC_URL!);

app.get('/', (req, res) => {
  res.send('Hello World!');
});

app.listen(PORT, () => {
  //listenDeposited().catch(console.error);
  return console.log(`Express is listening at http://localhost:${PORT}`);
});

app.post('/create-wallet', async (req, res) => {
    try {
  
      const authHeader = req.headers['authorization']; // lowercase key
      const sourceCode = req.headers['x-source-code'];
      const clientId = req.headers['x-client-id'];
      const clientSecret = req.headers['x-client-secret'];
  
      console.log('header ' + sourceCode + ' ' + clientId)
      const xClientId = process.env.X_CLIENT_ID
      const xClientSecret = process.env.X_CLIENT_SECRET;
      const xSourceCode = process.env.X_SOURCE_CODE;
  
      console.log('source code ' + xSourceCode + ' ' + xClientId)
      const chain = req.query.chain
      const symbol = req.query.symbol
      var response : any;
     
    
      //res.json(successResponse(response))
    } catch (error) {
      console.log(`Error creating wallet `)
      console.log(error)
      res.status(500).json({success:false,error:'error creating wallet ' + error})
    }
  })

  app.post('/api/rfq/create', async (req, res) => {
  try {
    const { amountNGN, tenorDays, maxFeeBPS, collType, collateralUSD } = req.body;

    const rfqId = await client.createRFQ(
      BigInt(amountNGN),
      Number(tenorDays),
      Number(maxFeeBPS),
      collType,
      BigInt(collateralUSD)
    );

    res.json({ success: true, rfqId });
  } catch (err: any) {
    console.error(err);
    res.status(500).json({ success: false, error: err.reason ?? err.shortMessage ?? err.message });
  }
})

app.post('/api/rfq/whitelist', async (req, res) => {
  try {
    const { walletAddress } = req.body;

    const rfqId = await client.approveKYB(walletAddress);

    res.json({ success: true, rfqId });
  } catch (err: any) {
    console.error(err);
    res.status(500).json({ success: false, error: err.reason ?? err.shortMessage ?? err.message });
  }
})

  app.post('/yield-deposit', async (req, res) => {
    try {
  
      if(!validateToken(req))
      {
        console.log(`Invalid authentication API key or token `)
        res.status(500).json({success:false,error:'Invalid authentication API key or token '})
        return;
      }

      const { amount,tokenAddress,rpcUrl,chain,contractAddress,key,usycContractAddress} = req.body;
      
      console.log('bal22 ' + usycContractAddress + ' ' + tokenAddress + " " + chain + " " + amount)
      console.log('rpc: ' + rpcUrl);
      var response : any;
      response = await usycDeposit(key, tokenAddress, rpcUrl, contractAddress, usycContractAddress, amount);
      
      res.json(response)
    
    } catch (error) {
      console.log(`Error yield deposit `)
      console.log(error)
      res.status(500).json({success:false,error:'error yield deposit ' + error})
    }
  })




  
  function validateToken(req: any)
  {
    const authHeader = req.headers['authorization']; // lowercase key
    const sourceCode = req.headers['x-source-code'];
    const clientId = req.headers['x-client-id'];
    const clientSecret = req.headers['x-client-secret'];

    console.log('header ' + sourceCode + ' ' + clientId)
    const xClientId = process.env.X_CLIENT_ID
    const xClientSecret = process.env.X_CLIENT_SECRET;
    const xSourceCode = process.env.X_SOURCE_CODE;

    console.log('source code ' + xSourceCode + ' ' + xClientId)
    console.log('source code ' + xSourceCode + ' ' + xClientId)

    return true;

  }
