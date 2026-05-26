# Build CRX and ZIP for v1.0.52
Continue = "Stop"

# Check if dist.pem exists for CRX signing
if (-not (Test-Path "apps/nilechain-farmer/dist.pem")) {
    Write-Host "Generating dist.pem for CRX signing..."
    node -e "require('crypto').generateKeyPairSync('rsa',{modulusLength:2048,publicKeyEncoding:{type:'spki',format:'pem'},privateKeyEncoding:{type:'pkcs8',format:'pem'})"
}

# Build extension only (not PWA/Whisker/Bridge for speed)
cd apps/nilechain-farmer
pnpm build-extension
cd ../..
