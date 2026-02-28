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
exports.initWallet = initWallet;
exports.createWallet = createWallet;
exports.fetchBalanceUSDC = fetchBalanceUSDC;
exports.transferUSDC = transferUSDC;
exports.transferQueryUSDC = transferQueryUSDC;
const dotenv_1 = __importDefault(require("dotenv"));
const developer_controlled_wallets_1 = require("@circle-fin/developer-controlled-wallets");
// This will print a new entity secret in the terminal
//generateEntitySecret()
dotenv_1.default.config();
function initWallet() {
    return __awaiter(this, void 0, void 0, function* () {
        //generateEntitySecret()
        var _a;
        //console.log(process.env.CRC_SECRET_CYPHER)
        const client = (0, developer_controlled_wallets_1.initiateDeveloperControlledWalletsClient)({
            apiKey: process.env.CRC_API_KEY,
            entitySecret: process.env.CRC_ENTITY_SECRET
        });
        const responsew = yield client.createWalletSet({
            name: 'Customer Wallet 1'
        });
        console.log(responsew);
        const walletId = (_a = responsew.data) === null || _a === void 0 ? void 0 : _a.walletSet.id;
        console.log('id: ' + walletId);
    });
}
function createWallet(name, walletSetId, chain) {
    return __awaiter(this, void 0, void 0, function* () {
        var _a;
        const client = (0, developer_controlled_wallets_1.initiateDeveloperControlledWalletsClient)({
            apiKey: process.env.CRC_API_KEY,
            entitySecret: process.env.CRC_ENTITY_SECRET
        });
        if (walletSetId == '') {
            const responsew = yield client.createWalletSet({
                name: name
            });
            //console.log(responsew);
            walletSetId = (_a = responsew.data) === null || _a === void 0 ? void 0 : _a.walletSet.id;
        }
        console.log('wallet sett id: ' + walletSetId + ' ' + chain);
        //var chains = JSON.parse("[" + chain + "]");
        //type Blockchain = "MATIC-AMOY" | "ETH-SEPOLIA" | "BTC-TESTNET";
        var chains = chain;
        //
        console.log('about to create wallet ');
        const response = yield client.createWallets({
            accountType: "SCA",
            blockchains: [chains],
            count: 1,
            walletSetId: walletSetId,
        });
        console.log(response);
        if (response.status == 201) {
            console.log('wallet address ' + response.data.wallets[0].address);
            console.log('wallet id ' + response.data.wallets[0].id);
            return { success: true, id: response.data.wallets[0].id, privateKey: response.data.wallets[0].address,
                address: response.data.wallets[0].address,
                chain: response.data.wallets[0].blockchain, phrase: walletSetId };
        }
        return { success: false, id: '', address: '',
            chain: '', phrase: '' };
    });
}
function fetchBalanceUSDC(walletId) {
    return __awaiter(this, void 0, void 0, function* () {
        const client = (0, developer_controlled_wallets_1.initiateDeveloperControlledWalletsClient)({
            apiKey: process.env.CRC_API_KEY,
            entitySecret: process.env.CRC_ENTITY_SECRET
        });
        const response = yield client.getWalletTokenBalance({
            id: walletId,
        });
        console.log(response);
        if (response.status == 200) {
            if (response.data.tokenBalances.length > 0) {
                console.log('wallet balance ' + response.data.tokenBalances[0].amount);
                console.log('wallet id ' + response.data.tokenBalances[0].token.id);
                var response2 = { success: true, balance: response.data.tokenBalances[0].amount, symbol: 'USDC',
                    id: response.data.tokenBalances[0].token.id };
                return response2;
            }
            else {
                return { success: true, balance: 0, symbol: 'USDC', id: '' };
            }
        }
        return { success: false, balance: 0, symbol: 'USDC', id: '' };
    });
}
function transferUSDC(sourceWalletId, beneficiaryWalletId, amount, sourceTokenId, externalRef, chain) {
    return __awaiter(this, void 0, void 0, function* () {
        const client = (0, developer_controlled_wallets_1.initiateDeveloperControlledWalletsClient)({
            apiKey: process.env.CRC_API_KEY,
            entitySecret: process.env.CRC_ENTITY_SECRET
        });
        const response = yield client.createTransaction({
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
        const txId = response.data.id;
        console.log('txtId ' + txId);
        //data: { id: '55b469eb-2c01-523d-8016-121cdee4dfd4', state: 'INITIATED' },
        //insertTranData(externalRef ,txId, chain);
        var response2 = { success: true, responseCode: 'PP', responseMessage: '', txId: txId, blockNumber: '',
            blockTimeStamp: '', status: response.data.state };
        for (let i = 0; i < 4; i++) {
            try {
                console.log(`Iteration ${i + 1} started`);
                if (i < 4) { // avoid sleeping after last iteration
                    console.log("Sleeping for 5 seconds...");
                    yield sleep(5000);
                    var responset = yield transferQueryUSDC(txId, 'USDC');
                    if (responset != null && responset.success)
                        return responset;
                }
            }
            catch (error) {
                console.log(error);
            }
        } //for
        return response2;
    });
}
function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}
function transferQueryUSDC(txId, symbol) {
    return __awaiter(this, void 0, void 0, function* () {
        var _a, _b, _c, _d, _e, _f, _g, _h, _j, _k, _l, _m, _o;
        const client = (0, developer_controlled_wallets_1.initiateDeveloperControlledWalletsClient)({
            apiKey: process.env.CRC_API_KEY,
            entitySecret: process.env.CRC_ENTITY_SECRET
        });
        console.log('txt query status ' + txId);
        const response = yield client.getTransaction({
            id: txId,
        });
        console.log((_a = response.data) === null || _a === void 0 ? void 0 : _a.transaction);
        console.log((_b = response.data) === null || _b === void 0 ? void 0 : _b.transaction.operation);
        if (((_c = response.data) === null || _c === void 0 ? void 0 : _c.transaction.operation) == 'TRANSFER') {
            var status2 = '';
            var statux = (_d = response.data) === null || _d === void 0 ? void 0 : _d.transaction.state.toString();
            if (statux == 'COMPLETE' || statux == 'CONFIRMED')
                statux = 'SUCCESS';
            console.log('statusx ' + statux);
            return { success: true, chain: (_e = response.data) === null || _e === void 0 ? void 0 : _e.transaction.blockchain,
                txId: txId, fee: (_f = response.data) === null || _f === void 0 ? void 0 : _f.transaction.networkFee,
                toAddress: (_g = response.data) === null || _g === void 0 ? void 0 : _g.transaction.destinationAddress,
                fromAddress: (_h = response.data) === null || _h === void 0 ? void 0 : _h.transaction.sourceAddress,
                blockRefNo: (_j = response.data) === null || _j === void 0 ? void 0 : _j.transaction.txHash,
                symbol: symbol,
                amount: (_k = response.data) === null || _k === void 0 ? void 0 : _k.transaction.amounts[0], blockNumber: (_l = response.data) === null || _l === void 0 ? void 0 : _l.transaction.blockHeight,
                blockTimestamp: (_m = response.data) === null || _m === void 0 ? void 0 : _m.transaction.firstConfirmDate,
                contractAddress: (_o = response.data) === null || _o === void 0 ? void 0 : _o.transaction.walletId, crDr: '', status: statux };
        }
        return null;
    });
}
//initWallet();
var wx = createWallet("Merchant Wallet", "f2d68602-382c-5eca-a719-fe40ac77d234", "ARC-TESTNET");
//fetchBalance('ebe05c72-2884-5c68-85e2-bd61aada7a80')
////fetchBalance('b79f7bf5-fbc8-5f88-ab6b-aa6cd41d56c7')
//transfer('ebe05c72-2884-5c68-85e2-bd61aada7a80','0xee8306a02e59b4527dc3fda555c5e40d61b29a73',0.1,'bdf128b4-827b-5267-8f9e-243694989b5f');
//console.log(transferQuery('55b469eb-2c01-523d-8016-121cdee4dfd4'))
0x3fece74e9fc392c3b6e2b0528c01f4f8c89028b1f5543121e2609ab3a4ae1e94;
//# sourceMappingURL=circle-wallet.js.map