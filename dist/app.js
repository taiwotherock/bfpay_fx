"use strict";
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
const cors_1 = __importDefault(require("cors"));
const dotenv_1 = __importDefault(require("dotenv"));
const win32_1 = __importDefault(require("path/win32"));
const usyc_mgr_1 = require("./usyc-mgr");
const bfpay_1 = require("./bfpay");
const ethers_1 = require("ethers");
dotenv_1.default.config();
const PORT = process.env.PORT;
//const API_KEY = process.env.API_KEY
//const ACCESS_TOKEN = process.env.ACCESS_TOKEN
const origins = process.env.CORS_ORIGIN;
const app = (0, express_1.default)();
app.use(express_1.default.json());
app.use((0, cors_1.default)());
app.use(express_1.default.static(win32_1.default.join(__dirname, 'public')));
const provider = new ethers_1.ethers.JsonRpcProvider(process.env.RPC_URL);
const wallet = new ethers_1.ethers.Wallet(process.env.PRIVATE_KEY, provider);
const client = new bfpay_1.BFPayClient(process.env.CONTRACT_ADDRESS, process.env.PRIVATE_KEY, process.env.RPC_URL);
app.get('/', (req, res) => {
    res.send('Hello World!');
});
app.listen(PORT, () => {
    //listenDeposited().catch(console.error);
    return console.log(`Express is listening at http://localhost:${PORT}`);
});
app.post('/create-wallet', (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const authHeader = req.headers['authorization']; // lowercase key
        const sourceCode = req.headers['x-source-code'];
        const clientId = req.headers['x-client-id'];
        const clientSecret = req.headers['x-client-secret'];
        console.log('header ' + sourceCode + ' ' + clientId);
        const xClientId = process.env.X_CLIENT_ID;
        const xClientSecret = process.env.X_CLIENT_SECRET;
        const xSourceCode = process.env.X_SOURCE_CODE;
        console.log('source code ' + xSourceCode + ' ' + xClientId);
        const chain = req.query.chain;
        const symbol = req.query.symbol;
        var response;
        //res.json(successResponse(response))
    }
    catch (error) {
        console.log(`Error creating wallet `);
        console.log(error);
        res.status(500).json({ success: false, error: 'error creating wallet ' + error });
    }
}));
app.post('/api/rfq/create', (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    var _a, _b;
    try {
        const { amountNGN, tenorDays, maxFeeBPS, collType, collateralUSD } = req.body;
        const rfqId = yield client.createRFQ(BigInt(amountNGN), Number(tenorDays), Number(maxFeeBPS), collType, BigInt(collateralUSD));
        res.json({ success: true, rfqId });
    }
    catch (err) {
        console.error(err);
        res.status(500).json({ success: false, error: (_b = (_a = err.reason) !== null && _a !== void 0 ? _a : err.shortMessage) !== null && _b !== void 0 ? _b : err.message });
    }
}));
app.post('/yield-deposit', (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        if (!validateToken(req)) {
            console.log(`Invalid authentication API key or token `);
            res.status(500).json({ success: false, error: 'Invalid authentication API key or token ' });
            return;
        }
        const { amount, tokenAddress, rpcUrl, chain, contractAddress, key, usycContractAddress } = req.body;
        console.log('bal22 ' + usycContractAddress + ' ' + tokenAddress + " " + chain + " " + amount);
        console.log('rpc: ' + rpcUrl);
        var response;
        response = yield (0, usyc_mgr_1.usycDeposit)(key, tokenAddress, rpcUrl, contractAddress, usycContractAddress, amount);
        res.json(response);
    }
    catch (error) {
        console.log(`Error yield deposit `);
        console.log(error);
        res.status(500).json({ success: false, error: 'error yield deposit ' + error });
    }
}));
function validateToken(req) {
    const authHeader = req.headers['authorization']; // lowercase key
    const sourceCode = req.headers['x-source-code'];
    const clientId = req.headers['x-client-id'];
    const clientSecret = req.headers['x-client-secret'];
    console.log('header ' + sourceCode + ' ' + clientId);
    const xClientId = process.env.X_CLIENT_ID;
    const xClientSecret = process.env.X_CLIENT_SECRET;
    const xSourceCode = process.env.X_SOURCE_CODE;
    console.log('source code ' + xSourceCode + ' ' + xClientId);
    console.log('source code ' + xSourceCode + ' ' + xClientId);
    return true;
}
//# sourceMappingURL=app.js.map