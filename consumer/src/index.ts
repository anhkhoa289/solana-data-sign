import * as mqtt from 'mqtt';
import * as anchor from '@coral-xyz/anchor';
import { Connection, Keypair, PublicKey } from '@solana/web3.js';
import * as nacl from 'tweetnacl';
import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import dotenv from 'dotenv';

dotenv.config();

// Configuration
const EMQX_BROKER = process.env.EMQX_BROKER || 'mqtt://emqx:1883';
const EMQX_TOPIC = process.env.EMQX_TOPIC || 'data/sensor/#';
const EMQX_CLIENT_ID = process.env.EMQX_CLIENT_ID || 'solana-consumer-' + Math.random().toString(16).slice(2, 8);
const EMQX_USERNAME = process.env.EMQX_USERNAME || '';
const EMQX_PASSWORD = process.env.EMQX_PASSWORD || '';

const SOLANA_RPC_URL = process.env.SOLANA_RPC_URL || 'https://api.devnet.solana.com';
const PROGRAM_ID = process.env.PROGRAM_ID || 'Fg6PaFpoGXkYsidMpWTK6W2BeZ7FEfcYkg476zPFsLnS';
const KEYPAIR_PATH = process.env.KEYPAIR_PATH || '/app/keypair.json';

interface DataMessage {
  data: string;
  timestamp?: number;
  source?: string;
}

class SolanaDataSignConsumer {
  private mqttClient: mqtt.MqttClient | null = null;
  private connection: Connection;
  private program: anchor.Program | null = null;
  private wallet: Keypair;
  private dataSignatureAccount: PublicKey | null = null;

  constructor() {
    console.log('Initializing Solana Data Sign Consumer...');
    this.connection = new Connection(SOLANA_RPC_URL, 'confirmed');
    this.wallet = this.loadWallet();
    console.log('Wallet loaded:', this.wallet.publicKey.toBase58());
  }

  private loadWallet(): Keypair {
    try {
      if (fs.existsSync(KEYPAIR_PATH)) {
        const keypairData = JSON.parse(fs.readFileSync(KEYPAIR_PATH, 'utf-8'));
        return Keypair.fromSecretKey(Uint8Array.from(keypairData));
      } else {
        console.log('Keypair not found, generating new one...');
        const newKeypair = Keypair.generate();
        fs.writeFileSync(KEYPAIR_PATH, JSON.stringify(Array.from(newKeypair.secretKey)));
        console.log('New keypair generated and saved to:', KEYPAIR_PATH);
        console.log('Public key:', newKeypair.publicKey.toBase58());
        console.log('Please fund this wallet with devnet SOL: https://faucet.solana.com');
        return newKeypair;
      }
    } catch (error) {
      console.error('Error loading wallet:', error);
      throw error;
    }
  }

  private async initializeProgram() {
    try {
      // Load IDL
      const idlPath = path.join(__dirname, '../../target/idl/solana_data_sign.json');
      if (!fs.existsSync(idlPath)) {
        console.warn('IDL not found at:', idlPath);
        console.warn('Please build the Anchor program first: anchor build');
        return;
      }

      const idl = JSON.parse(fs.readFileSync(idlPath, 'utf-8'));
      const programId = new PublicKey(PROGRAM_ID);

      // Create provider
      const provider = new anchor.AnchorProvider(
        this.connection,
        new anchor.Wallet(this.wallet),
        { commitment: 'confirmed' }
      );

      // Initialize program
      this.program = new anchor.Program(idl, programId, provider);
      console.log('Anchor program initialized');

      // Check or create data signature account
      await this.initializeDataSignatureAccount();
    } catch (error) {
      console.error('Error initializing program:', error);
    }
  }

  private async initializeDataSignatureAccount() {
    try {
      // Generate a new account for data signatures
      const dataSignatureKeypair = Keypair.generate();
      this.dataSignatureAccount = dataSignatureKeypair.publicKey;

      console.log('Checking if data signature account exists...');

      try {
        const account = await this.program!.account.dataSignature.fetch(this.dataSignatureAccount);
        console.log('Data signature account already exists:', this.dataSignatureAccount.toBase58());
        console.log('Signature count:', account.signatureCount.toString());
      } catch (e) {
        console.log('Creating new data signature account...');

        const tx = await this.program!.methods
          .initialize()
          .accounts({
            dataSignature: this.dataSignatureAccount,
            authority: this.wallet.publicKey,
            systemProgram: anchor.web3.SystemProgram.programId,
          })
          .signers([dataSignatureKeypair])
          .rpc();

        console.log('Data signature account created:', this.dataSignatureAccount.toBase58());
        console.log('Transaction signature:', tx);
      }
    } catch (error) {
      console.error('Error initializing data signature account:', error);
    }
  }

  private connectToEMQX() {
    console.log('Connecting to EMQX broker:', EMQX_BROKER);

    const options: mqtt.IClientOptions = {
      clientId: EMQX_CLIENT_ID,
      clean: true,
      reconnectPeriod: 5000,
    };

    if (EMQX_USERNAME) {
      options.username = EMQX_USERNAME;
      options.password = EMQX_PASSWORD;
    }

    this.mqttClient = mqtt.connect(EMQX_BROKER, options);

    this.mqttClient.on('connect', () => {
      console.log('Connected to EMQX broker');
      this.mqttClient!.subscribe(EMQX_TOPIC, (err) => {
        if (err) {
          console.error('Failed to subscribe to topic:', err);
        } else {
          console.log('Subscribed to topic:', EMQX_TOPIC);
        }
      });
    });

    this.mqttClient.on('message', async (topic, message) => {
      await this.handleMessage(topic, message);
    });

    this.mqttClient.on('error', (error) => {
      console.error('MQTT error:', error);
    });

    this.mqttClient.on('close', () => {
      console.log('MQTT connection closed');
    });

    this.mqttClient.on('reconnect', () => {
      console.log('Reconnecting to EMQX...');
    });
  }

  private async handleMessage(topic: string, message: Buffer) {
    try {
      console.log('\n--- New message received ---');
      console.log('Topic:', topic);
      console.log('Message:', message.toString());

      let dataMessage: DataMessage;
      try {
        dataMessage = JSON.parse(message.toString());
      } catch {
        // If not JSON, treat as plain text
        dataMessage = {
          data: message.toString(),
          timestamp: Date.now(),
          source: topic,
        };
      }

      // Add timestamp if not present
      if (!dataMessage.timestamp) {
        dataMessage.timestamp = Date.now();
      }

      // Sign and store on Solana
      await this.signAndStore(dataMessage);
    } catch (error) {
      console.error('Error handling message:', error);
    }
  }

  private async signAndStore(dataMessage: DataMessage) {
    try {
      if (!this.program || !this.dataSignatureAccount) {
        console.warn('Program not initialized, skipping blockchain storage');
        return;
      }

      // Create hash of the data
      const dataString = JSON.stringify(dataMessage);
      const dataHash = crypto.createHash('sha256').update(dataString).digest();
      const dataHashArray = Array.from(dataHash);

      // Sign the data hash with the wallet
      const signature = nacl.sign.detached(dataHash, this.wallet.secretKey);
      const signatureArray = Array.from(signature);

      console.log('Data hash:', dataHash.toString('hex'));
      console.log('Signature created');

      // Get current signature count to derive PDA
      const account = await this.program.account.dataSignature.fetch(this.dataSignatureAccount);
      const signatureCount = account.signatureCount;

      // Derive the signature record PDA
      const [signatureRecordPDA] = PublicKey.findProgramAddressSync(
        [
          Buffer.from('signature'),
          this.dataSignatureAccount.toBuffer(),
          signatureCount.toArrayLike(Buffer, 'le', 8),
        ],
        this.program.programId
      );

      console.log('Storing signature on Solana...');
      console.log('Signature record PDA:', signatureRecordPDA.toBase58());

      const tx = await this.program.methods
        .storeSignature(
          dataHashArray,
          signatureArray,
          new anchor.BN(dataMessage.timestamp || Date.now())
        )
        .accounts({
          dataSignature: this.dataSignatureAccount,
          signatureRecord: signatureRecordPDA,
          authority: this.wallet.publicKey,
          systemProgram: anchor.web3.SystemProgram.programId,
        })
        .rpc();

      console.log('✓ Signature stored on Solana!');
      console.log('Transaction signature:', tx);
      console.log('Explorer:', `https://explorer.solana.com/tx/${tx}?cluster=devnet`);
    } catch (error) {
      console.error('Error signing and storing data:', error);
    }
  }

  public async start() {
    console.log('\n=== Starting Solana Data Sign Consumer ===\n');

    // Initialize Solana program
    await this.initializeProgram();

    // Connect to EMQX
    this.connectToEMQX();

    console.log('\n=== Consumer is running ===');
    console.log('Waiting for messages from EMQX...\n');
  }

  public stop() {
    if (this.mqttClient) {
      this.mqttClient.end();
    }
    console.log('Consumer stopped');
  }
}

// Main
const consumer = new SolanaDataSignConsumer();

consumer.start().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});

// Graceful shutdown
process.on('SIGINT', () => {
  console.log('\nShutting down...');
  consumer.stop();
  process.exit(0);
});

process.on('SIGTERM', () => {
  console.log('\nShutting down...');
  consumer.stop();
  process.exit(0);
});
