import { SuiClient } from '@onelabs/sui/client';
import { Ed25519Keypair } from '@onelabs/sui/keypairs/ed25519';
import { fromB64 } from '@onelabs/sui/utils';
import * as fs from 'fs';
import * as path from 'path';

// Configuration
const TESTNET_URL = 'https://rpc-testnet.onelabs.cc:443';
const FAUCET_URL = 'https://faucet-testnet.onelabs.cc:443';

async function main() {
    console.log('🚰 Requesting testnet tokens from OneChain faucet...');
    
    // Load keypair
    let keypair: Ed25519Keypair;
    try {
        const keyfilePath = path.join(__dirname, '../.sui/sui_config/sui.keystore');
        if (fs.existsSync(keyfilePath)) {
            const keystore = JSON.parse(fs.readFileSync(keyfilePath, 'utf8'));
            const privateKey = fromB64(keystore[0]);
            keypair = Ed25519Keypair.fromSecretKey(privateKey);
            console.log('✅ Loaded existing keypair from keystore');
        } else {
            // Generate new keypair
            keypair = new Ed25519Keypair();
            console.log('✅ Generated new keypair');
            console.log(`📝 Public key: ${keypair.getPublicKey().toSuiAddress()}`);
            console.log('⚠️  Please save this keypair securely!');
            
            // Save to keystore
            const keystoreDir = path.join(__dirname, '../.sui/sui_config');
            if (!fs.existsSync(keystoreDir)) {
                fs.mkdirSync(keystoreDir, { recursive: true });
            }
            
            const keystore = [keypair.export().privateKey];
            fs.writeFileSync(keyfilePath, JSON.stringify(keystore, null, 2));
            console.log('💾 Keypair saved to keystore');
        }
    } catch (error) {
        console.error('❌ Error loading/generating keypair:', error);
        return;
    }
    
    const address = keypair.getPublicKey().toSuiAddress();
    console.log(`📍 Address: ${address}`);
    
    // Initialize Sui client
    const client = new SuiClient({ url: TESTNET_URL });
    console.log(`✅ Connected to OneChain testnet: ${TESTNET_URL}`);
    
    // Check current balance
    try {
        const balance = await client.getBalance({
            owner: address,
            coinType: '0x2::sui::SUI'
        });
        
        console.log(`💰 Current balance: ${balance.totalBalance} SUI`);
        
        if (parseInt(balance.totalBalance) > 1000000000) {
            console.log('✅ Sufficient balance already available');
            return;
        }
    } catch (error) {
        console.log('⚠️  Could not fetch current balance, proceeding with faucet request...');
    }
    
    // Request tokens from faucet
    console.log('\n🚰 Requesting tokens from faucet...');
    try {
        const response = await fetch(`${FAUCET_URL}/gas`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                FixedAmountRequest: {
                    recipient: address
                }
            })
        });
        
        if (response.ok) {
            const result = await response.json();
            console.log('✅ Faucet request successful!');
            console.log(`📝 Transaction ID: ${result.txDigest || 'Pending'}`);
            
            if (result.txDigest) {
                console.log('\n⏳ Waiting for transaction confirmation...');
                
                // Wait for transaction confirmation
                let confirmed = false;
                let attempts = 0;
                const maxAttempts = 30; // 30 seconds
                
                while (!confirmed && attempts < maxAttempts) {
                    try {
                        const txInfo = await client.getTransactionBlock({
                            digest: result.txDigest,
                            options: { showEffects: true }
                        });
                        
                        if (txInfo.effects?.status?.status === 'success') {
                            confirmed = true;
                            console.log('✅ Transaction confirmed!');
                            
                            // Check new balance
                            const newBalance = await client.getBalance({
                                owner: address,
                                coinType: '0x2::sui::SUI'
                            });
                            
                            console.log(`💰 New balance: ${newBalance.totalBalance} SUI`);
                            
                        } else if (txInfo.effects?.status?.status === 'failure') {
                            console.log('❌ Transaction failed');
                            console.log(`Error: ${txInfo.effects.status.error}`);
                            break;
                        }
                    } catch (error) {
                        // Transaction might still be pending
                    }
                    
                    attempts++;
                    await new Promise(resolve => setTimeout(resolve, 1000)); // Wait 1 second
                }
                
                if (!confirmed) {
                    console.log('⚠️  Transaction confirmation timeout. Please check manually.');
                }
            }
            
        } else {
            const errorText = await response.text();
            console.error('❌ Faucet request failed:', response.status, errorText);
            
            if (response.status === 429) {
                console.log('⚠️  Rate limited. Please wait before trying again.');
            }
        }
        
    } catch (error) {
        console.error('❌ Error requesting from faucet:', error);
        
        // Fallback: manual faucet instructions
        console.log('\n📋 Manual faucet instructions:');
        console.log(`1. Visit: ${FAUCET_URL}`);
        console.log(`2. Enter your address: ${address}`);
        console.log('3. Request testnet tokens');
        console.log('4. Wait for confirmation');
    }
    
    // Alternative: try to get tokens from Sui devnet faucet
    console.log('\n🔄 Trying alternative faucet...');
    try {
        const suiResponse = await fetch('https://faucet.testnet.sui.io/gas', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                FixedAmountRequest: {
                    recipient: address
                }
            })
        });
        
        if (suiResponse.ok) {
            const suiResult = await suiResponse.json();
            console.log('✅ Alternative faucet request successful!');
            console.log(`📝 Transaction ID: ${suiResult.txDigest || 'Pending'}`);
        } else {
            console.log('⚠️  Alternative faucet also failed');
        }
        
    } catch (error) {
        console.log('⚠️  Alternative faucet unavailable');
    }
    
    console.log('\n🎉 Faucet process completed!');
    console.log('💡 If you received tokens, you can now proceed with deployment.');
}

// Error handling
process.on('unhandledRejection', (error) => {
    console.error('❌ Unhandled rejection:', error);
    process.exit(1);
});

// Run faucet
main()
    .then(() => {
        console.log('\n✅ Faucet process completed successfully!');
        process.exit(0);
    })
    .catch((error) => {
        console.error('\n💥 Faucet process failed:', error);
        process.exit(1);
    });
