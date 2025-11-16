# Solana Data Sign - EMQX Integration

Dự án Solana Anchor để nhận dữ liệu từ EMQX, ký dữ liệu và lưu chữ ký lên blockchain Solana.

## Tính năng

- **EMQX Consumer**: Nhận dữ liệu từ EMQX broker qua MQTT
- **Data Signing**: Ký dữ liệu bằng Ed25519 signature
- **On-chain Storage**: Lưu trữ chữ ký và hash dữ liệu trên Solana blockchain
- **Docker Support**: Triển khai đầy đủ với Docker Compose
- **Testnet**: Sử dụng Solana Devnet

## Kiến trúc

```
┌─────────────┐         MQTT          ┌──────────────────┐
│   EMQX      │ ──────────────────────> │  Consumer        │
│   Broker    │                         │  Service         │
└─────────────┘                         └────────┬─────────┘
                                                 │
                                                 │ Sign & Store
                                                 │
                                                 ▼
                                        ┌─────────────────┐
                                        │  Solana         │
                                        │  Devnet         │
                                        └─────────────────┘
```

## Yêu cầu

- Docker và Docker Compose
- Node.js 20+ (nếu chạy local)
- Rust và Anchor CLI (nếu phát triển smart contract)
- Solana CLI (để quản lý wallet)

## Cài đặt

### 1. Clone repository

```bash
git clone <repository-url>
cd solana-data-sign
```

### 2. Tạo Solana Wallet

```bash
# Cài đặt Solana CLI (nếu chưa có)
sh -c "$(curl -sSfL https://release.solana.com/stable/install)"

# Tạo keypair mới
solana-keygen new --outfile keypair.json

# Hoặc sử dụng Makefile
make keypair

# Xem public key
solana-keygen pubkey keypair.json

# Lấy SOL từ faucet (devnet)
solana airdrop 2 <YOUR_PUBLIC_KEY> --url devnet

# Hoặc sử dụng Makefile
make airdrop
```

### 3. Build và Deploy Smart Contract

```bash
# Cài đặt dependencies
npm install

# Build Anchor program
anchor build

# Hoặc sử dụng Makefile
make build

# Deploy lên devnet
anchor deploy --provider.cluster devnet

# Hoặc sử dụng Makefile
make deploy
```

**Lưu ý**: Sau khi deploy, cập nhật `PROGRAM_ID` trong các file:
- `Anchor.toml`
- `programs/solana-data-sign/src/lib.rs` (declare_id!)
- `.env.example`

### 4. Chạy với Docker Compose

```bash
# Copy environment file
cp .env.example .env

# Build và chạy tất cả services
docker-compose up --build

# Chạy ở background
docker-compose up -d

# Hoặc sử dụng Makefile
make up
```

## Sử dụng

### Truy cập EMQX Dashboard

- URL: http://localhost:18083
- Username: `admin`
- Password: `public`

### Gửi dữ liệu test

Dự án đã bao gồm một MQTT publisher tự động gửi dữ liệu test mỗi 10 giây. Hoặc bạn có thể gửi thủ công:

```bash
# Sử dụng mosquitto_pub
docker exec -it emqx mosquitto_pub \
  -h localhost \
  -t 'data/sensor/temperature' \
  -m '{"data":"Temperature: 28.5C","timestamp":1234567890,"source":"sensor-01"}'

# Hoặc sử dụng Makefile
make publish-test
```

### Theo dõi logs

```bash
# Xem logs của consumer
docker-compose logs -f solana-consumer

# Xem logs của EMQX
docker-compose logs -f emqx

# Hoặc sử dụng Makefile
make logs-consumer
make logs-emqx
make logs  # All services
```

### Kiểm tra transactions trên Solana

Khi consumer nhận và xử lý dữ liệu, nó sẽ in ra transaction signature. Bạn có thể xem trên Solana Explorer:

```
https://explorer.solana.com/tx/<TRANSACTION_SIGNATURE>?cluster=devnet
```

## Cấu trúc dự án

```
solana-data-sign/
├── programs/
│   └── solana-data-sign/
│       └── src/
│           └── lib.rs              # Anchor smart contract
├── consumer/
│   └── src/
│       └── index.ts                # EMQX consumer service
├── Anchor.toml                     # Anchor configuration
├── Cargo.toml                      # Rust workspace
├── docker-compose.yml              # Docker Compose config
├── Dockerfile                      # Consumer Dockerfile
├── Makefile                        # Build automation
└── README.md                       # Documentation
```

## Smart Contract

### Instructions

1. **initialize**: Khởi tạo account để lưu trữ signatures
2. **store_signature**: Lưu data hash và signature lên chain
3. **verify_signature**: Xác minh signature đã lưu

### Accounts

- **DataSignature**: Account chính quản lý signatures
  - `authority`: Public key của người có quyền
  - `signature_count`: Số lượng signatures đã lưu

- **SignatureRecord**: Record cho mỗi signature
  - `data_hash`: SHA-256 hash của dữ liệu
  - `signature`: Ed25519 signature
  - `timestamp`: Thời gian ký
  - `signer`: Public key của người ký
  - `index`: Số thứ tự

## Consumer Service

Consumer service thực hiện:

1. Kết nối đến EMQX broker
2. Subscribe topic `data/sensor/#`
3. Nhận dữ liệu từ MQTT
4. Tạo SHA-256 hash của dữ liệu
5. Ký hash bằng Ed25519
6. Gọi smart contract để lưu signature lên chain

## Cấu hình

Các biến môi trường (`.env`):

```bash
# EMQX
EMQX_BROKER=mqtt://emqx:1883
EMQX_TOPIC=data/sensor/#
EMQX_USERNAME=
EMQX_PASSWORD=

# Solana
SOLANA_RPC_URL=https://api.devnet.solana.com
PROGRAM_ID=<YOUR_PROGRAM_ID>
KEYPAIR_PATH=/app/keypair.json
```

## Development

### Chạy consumer local (không dùng Docker)

```bash
# Cài đặt dependencies
cd consumer
npm install

# Chạy development mode
npm run dev
```

### Test smart contract

```bash
# Chạy tests
anchor test

# Hoặc
make test
```

### Build lại

```bash
# Build smart contract
anchor build

# Build consumer
cd consumer && npm run build

# Hoặc
make build
```

## Makefile Commands

```bash
make help          # Show all available commands
make install       # Install dependencies
make build         # Build program and consumer
make deploy        # Deploy to devnet
make up            # Start docker services
make down          # Stop docker services
make logs          # Show all logs
make clean         # Clean build artifacts
make test          # Run tests
make keypair       # Generate new keypair
make airdrop       # Request SOL airdrop
make balance       # Check wallet balance
make publish-test  # Publish test message
```

## Troubleshooting

### Consumer không kết nối được EMQX

- Kiểm tra EMQX đã chạy: `docker-compose ps`
- Xem logs: `docker-compose logs emqx`
- Kiểm tra network: `docker network ls`

### Transaction failed

- Kiểm tra wallet có đủ SOL: `solana balance <PUBLIC_KEY> --url devnet`
- Lấy thêm SOL: `solana airdrop 2 <PUBLIC_KEY> --url devnet`
- Kiểm tra program ID đã đúng chưa

### IDL not found

- Build program trước: `anchor build`
- Kiểm tra file tồn tại: `target/idl/solana_data_sign.json`

## License

ISC

## Tác giả

Developed with Solana Anchor Framework
