#Requires -Version 5.1
[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)]
  [string]$SshHost,

  [Parameter(Mandatory = $true)]
  [string]$SshUser,

  [string]$SshKeyPath = "",

  [int]$SshPort = 22,

  [Parameter(Mandatory = $true)]
  [string]$Domain,

  [Parameter(Mandatory = $true)]
  [string]$TickTickClientId,

  [securestring]$TickTickClientSecret,

  [string]$RepoUrl = "https://github.com/zoomerland/ticktick-mcp-bridge.git",

  [string]$Branch = "main",

  [string]$RemoteRoot = "/opt/ticktick-mcp-bridge",

  [string]$ServiceUser = "ticktick-mcp",

  [string]$ChatGptOAuthClientId = "ticktick-mcp-chatgpt",

  [securestring]$ChatGptOAuthClientSecret,

  [securestring]$AppSharedSecret,

  [securestring]$ChatGptOAuthTokenSecret,

  [switch]$SkipPackageInstall,

  [ValidateSet("auto", "caddy", "nginx", "manual", "none")]
  [string]$ReverseProxy = "auto",

  [switch]$SkipCaddyInstall,

  [switch]$StagingSelfSigned,

  [string]$NginxSslCertificatePath = "",

  [string]$NginxSslCertificateKeyPath = "",

  [switch]$AllowSelfSignedHealthCheck,

  [switch]$SkipExternalHealthCheck
)

Set-StrictMode -Version 2.0
$ErrorActionPreference = "Stop"

function ConvertFrom-SecureStringPlainText {
  param([securestring]$Value)
  if (-not $Value) { return "" }
  $bstr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($Value)
  try {
    return [Runtime.InteropServices.Marshal]::PtrToStringBSTR($bstr)
  } finally {
    [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($bstr)
  }
}

function New-Secret {
  param([int]$Bytes = 48)
  $buffer = New-Object byte[] $Bytes
  $rng = [Security.Cryptography.RandomNumberGenerator]::Create()
  try {
    $rng.GetBytes($buffer)
    return [Convert]::ToBase64String($buffer)
  } finally {
    $rng.Dispose()
  }
}

function Quote-Bash {
  param([string]$Value)
  return "'" + ($Value -replace "'", "'\''") + "'"
}

function Invoke-RemoteScript {
  param([string]$Script)
  $lfScript = $Script -replace "`r", ""
  $lfScript | & ssh @script:SshArgs "bash -s"
  if ($LASTEXITCODE -ne 0) {
    throw "Remote SSH script failed with exit code $LASTEXITCODE."
  }
}

function Invoke-RemoteInput {
  param(
    [string]$InputText,
    [string]$RemoteCommand
  )
  $lfInput = $InputText -replace "`r", ""
  $lfInput | & ssh @script:SshArgs $RemoteCommand
  if ($LASTEXITCODE -ne 0) {
    throw "Remote SSH input command failed with exit code $LASTEXITCODE."
  }
}

if (-not $TickTickClientSecret) {
  $TickTickClientSecret = Read-Host "TickTick client secret" -AsSecureString
}

$tickTickSecretPlain = ConvertFrom-SecureStringPlainText $TickTickClientSecret
if ([string]::IsNullOrWhiteSpace($tickTickSecretPlain)) {
  throw "TickTick client secret is required."
}

$chatGptSecretPlain = ConvertFrom-SecureStringPlainText $ChatGptOAuthClientSecret
if ([string]::IsNullOrWhiteSpace($chatGptSecretPlain)) {
  $chatGptSecretPlain = New-Secret
}

$appSharedSecretPlain = ConvertFrom-SecureStringPlainText $AppSharedSecret
if ([string]::IsNullOrWhiteSpace($appSharedSecretPlain)) {
  $appSharedSecretPlain = New-Secret
}

$tokenSecretPlain = ConvertFrom-SecureStringPlainText $ChatGptOAuthTokenSecret
if ([string]::IsNullOrWhiteSpace($tokenSecretPlain)) {
  $tokenSecretPlain = New-Secret
}

$Domain = $Domain.Trim().TrimEnd("/")
if ($Domain -notmatch "^[A-Za-z0-9.-]+$") {
  throw "Domain must be a bare hostname, for example ticktick-mcp.example.com."
}

if ($SkipCaddyInstall -and $ReverseProxy -eq "auto") {
  Write-Warning "-SkipCaddyInstall is deprecated. Using -ReverseProxy manual for this run."
  $ReverseProxy = "manual"
}

$publicBaseUrl = "https://$Domain"
$tickTickRedirectUri = "$publicBaseUrl/oauth/callback"
$packageDir = "$RemoteRoot/plugins/ticktick-mcp-bridge"
$authDir = "/var/lib/ticktick-mcp-bridge"
$authFile = "$authDir/auth.json"
$serviceName = "ticktick-mcp-bridge"
$sshTarget = "$SshUser@$SshHost"

$script:SshArgs = @("-p", [string]$SshPort)
if (-not [string]::IsNullOrWhiteSpace($SshKeyPath)) {
  $script:SshArgs += @("-i", $SshKeyPath)
}
$script:SshArgs += @($sshTarget)

Write-Host "==> Testing SSH access to $sshTarget"
& ssh @script:SshArgs "printf 'ssh-ok\n'"
if ($LASTEXITCODE -ne 0) {
  throw "SSH connection failed. Check host, user, key, password, firewall, and port."
}

$envContent = @"
PORT=8787
BIND_HOST=127.0.0.1
PUBLIC_BASE_URL=$publicBaseUrl

TICKTICK_CLIENT_ID=$TickTickClientId
TICKTICK_CLIENT_SECRET=$tickTickSecretPlain
TICKTICK_REDIRECT_URI=$tickTickRedirectUri

APP_SHARED_SECRET=$appSharedSecretPlain
CHATGPT_OAUTH_CLIENT_ID=$ChatGptOAuthClientId
CHATGPT_OAUTH_CLIENT_SECRET=$chatGptSecretPlain
CHATGPT_OAUTH_TOKEN_SECRET=$tokenSecretPlain
CHATGPT_OAUTH_SCOPES=ticktick:read ticktick:write
ALLOW_UNAUTHENTICATED_PUBLIC_MCP=false

TICKTICK_AUTH_FILE=$authFile
"@

$remoteBootstrap = @"
set -euo pipefail
REMOTE_ROOT=$(Quote-Bash $RemoteRoot)
REPO_URL=$(Quote-Bash $RepoUrl)
BRANCH=$(Quote-Bash $Branch)
SERVICE_USER=$(Quote-Bash $ServiceUser)
PACKAGE_DIR=$(Quote-Bash $packageDir)
AUTH_DIR=$(Quote-Bash $authDir)
SERVICE_NAME=$(Quote-Bash $serviceName)
DOMAIN=$(Quote-Bash $Domain)
SKIP_PACKAGE_INSTALL=$(Quote-Bash ([string][bool]$SkipPackageInstall))
REVERSE_PROXY=$(Quote-Bash $ReverseProxy)

choose_reverse_proxy() {
  case "`$REVERSE_PROXY" in
    auto)
      if systemctl is-active --quiet caddy 2>/dev/null || { command -v caddy >/dev/null 2>&1 && ! systemctl is-active --quiet nginx 2>/dev/null; }; then
        echo caddy
      elif systemctl is-active --quiet nginx 2>/dev/null || command -v nginx >/dev/null 2>&1; then
        echo nginx
      else
        echo caddy
      fi
      ;;
    none|manual)
      echo manual
      ;;
    caddy|nginx)
      echo "`$REVERSE_PROXY"
      ;;
    *)
      echo "Unsupported reverse proxy mode: `$REVERSE_PROXY" >&2
      exit 4
      ;;
  esac
}

SELECTED_REVERSE_PROXY="`$(choose_reverse_proxy)"
echo "Selected reverse proxy mode: `$SELECTED_REVERSE_PROXY"

if [ "`$SKIP_PACKAGE_INSTALL" != "True" ]; then
  if ! command -v apt-get >/dev/null 2>&1; then
    echo "This helper currently supports Ubuntu/Debian servers with apt-get." >&2
    exit 2
  fi
  sudo apt-get update
  sudo apt-get install -y git curl ca-certificates gnupg debian-keyring debian-archive-keyring apt-transport-https openssl
  if ! command -v node >/dev/null 2>&1 || [ "`$(node -p 'Number(process.versions.node.split(".")[0])' 2>/dev/null || echo 0)" -lt 20 ]; then
    curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
    sudo apt-get install -y nodejs
  fi
  if [ "`$SELECTED_REVERSE_PROXY" = "caddy" ] && ! command -v caddy >/dev/null 2>&1; then
    sudo rm -f /usr/share/keyrings/caddy-stable-archive-keyring.gpg
    curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | sudo gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
    curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' | sudo tee /etc/apt/sources.list.d/caddy-stable.list >/dev/null
    sudo apt-get update
    sudo apt-get install -y caddy
  fi
  if [ "`$SELECTED_REVERSE_PROXY" = "nginx" ] && ! command -v nginx >/dev/null 2>&1; then
    sudo apt-get install -y nginx
  fi
fi

SSH_USER_NAME="`$(id -un)"

if [ -d "`$REMOTE_ROOT/.git" ]; then
  sudo chown -R "`$SSH_USER_NAME:`$SSH_USER_NAME" "`$REMOTE_ROOT"
  git -C "`$REMOTE_ROOT" fetch origin
  git -C "`$REMOTE_ROOT" checkout "`$BRANCH"
  git -C "`$REMOTE_ROOT" pull --ff-only origin "`$BRANCH"
elif [ -d "`$REMOTE_ROOT" ] && [ -z "`$(ls -A "`$REMOTE_ROOT" 2>/dev/null)" ]; then
  sudo chown "`$SSH_USER_NAME:`$SSH_USER_NAME" "`$REMOTE_ROOT"
  rmdir "`$REMOTE_ROOT"
  git clone --branch "`$BRANCH" "`$REPO_URL" "`$REMOTE_ROOT"
elif [ -e "`$REMOTE_ROOT" ]; then
  echo "`$REMOTE_ROOT exists but is not a git checkout. Move it aside or choose another -RemoteRoot." >&2
  exit 3
else
  sudo mkdir -p "`$REMOTE_ROOT"
  sudo chown "`$SSH_USER_NAME:`$SSH_USER_NAME" "`$REMOTE_ROOT"
  rmdir "`$REMOTE_ROOT"
  git clone --branch "`$BRANCH" "`$REPO_URL" "`$REMOTE_ROOT"
fi

sudo useradd --system --home "`$AUTH_DIR" --shell /usr/sbin/nologin "`$SERVICE_USER" 2>/dev/null || true
sudo mkdir -p "`$AUTH_DIR"
sudo chown "`$SERVICE_USER:`$SERVICE_USER" "`$AUTH_DIR"
sudo chmod 700 "`$AUTH_DIR"
sudo chown -R "`$SSH_USER_NAME:`$SSH_USER_NAME" "`$REMOTE_ROOT"

cd "`$PACKAGE_DIR"
npm run check
npm test
"@

Write-Host "==> Installing packages, cloning/updating repository, and running checks"
Invoke-RemoteScript $remoteBootstrap

Write-Host "==> Uploading service environment to VPS"
$envInstallCommand = "sudo install -d -m 0750 " + (Quote-Bash $packageDir) + " && sudo tee " + (Quote-Bash "$packageDir/.env") + " >/dev/null && sudo chmod 600 " + (Quote-Bash "$packageDir/.env")
Invoke-RemoteInput -InputText $envContent -RemoteCommand $envInstallCommand

$remoteService = @"
set -euo pipefail
PACKAGE_DIR=$(Quote-Bash $packageDir)
AUTH_DIR=$(Quote-Bash $authDir)
SERVICE_USER=$(Quote-Bash $ServiceUser)
SERVICE_NAME=$(Quote-Bash $serviceName)
DOMAIN=$(Quote-Bash $Domain)
REVERSE_PROXY=$(Quote-Bash $ReverseProxy)
STAGING_SELF_SIGNED=$(Quote-Bash ([string][bool]$StagingSelfSigned))
NGINX_SSL_CERTIFICATE=$(Quote-Bash $NginxSslCertificatePath)
NGINX_SSL_CERTIFICATE_KEY=$(Quote-Bash $NginxSslCertificateKeyPath)

choose_reverse_proxy() {
  case "`$REVERSE_PROXY" in
    auto)
      if systemctl is-active --quiet caddy 2>/dev/null || { command -v caddy >/dev/null 2>&1 && ! systemctl is-active --quiet nginx 2>/dev/null; }; then
        echo caddy
      elif systemctl is-active --quiet nginx 2>/dev/null || command -v nginx >/dev/null 2>&1; then
        echo nginx
      else
        echo caddy
      fi
      ;;
    none|manual)
      echo manual
      ;;
    caddy|nginx)
      echo "`$REVERSE_PROXY"
      ;;
    *)
      echo "Unsupported reverse proxy mode: `$REVERSE_PROXY" >&2
      exit 4
      ;;
  esac
}

SELECTED_REVERSE_PROXY="`$(choose_reverse_proxy)"
echo "Configuring reverse proxy mode: `$SELECTED_REVERSE_PROXY"

cat <<UNIT | sudo tee /etc/systemd/system/`$SERVICE_NAME.service >/dev/null
[Unit]
Description=TickTick MCP Bridge
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=`$SERVICE_USER
Group=`$SERVICE_USER
WorkingDirectory=`$PACKAGE_DIR
EnvironmentFile=`$PACKAGE_DIR/.env
ExecStart=/usr/bin/node src/server.mjs
Restart=on-failure
RestartSec=5
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=full
ProtectHome=true
ReadWritePaths=`$AUTH_DIR

[Install]
WantedBy=multi-user.target
UNIT

sudo systemctl daemon-reload
sudo systemctl enable --now "`$SERVICE_NAME"
sudo systemctl restart "`$SERVICE_NAME"
sleep 2
systemctl is-active "`$SERVICE_NAME"

if [ "`$SELECTED_REVERSE_PROXY" = "caddy" ]; then
  sudo mkdir -p /etc/caddy/conf.d
  if [ ! -f /etc/caddy/Caddyfile ]; then
    sudo touch /etc/caddy/Caddyfile
  fi
  if ! grep -q "import /etc/caddy/conf.d/\\*.caddy" /etc/caddy/Caddyfile; then
    sudo cp /etc/caddy/Caddyfile /etc/caddy/Caddyfile.ticktick-mcp-bridge.bak.`$(date +%Y%m%d%H%M%S)
    printf '\n# ticktick-mcp-bridge helper imports\nimport /etc/caddy/conf.d/*.caddy\n' | sudo tee -a /etc/caddy/Caddyfile >/dev/null
  fi
  CADDY_SITE="/etc/caddy/conf.d/ticktick-mcp-bridge.caddy"
  TLS_LINE=""
  if [ "`$STAGING_SELF_SIGNED" = "True" ]; then
    TLS_LINE="  tls internal"
  fi
  cat <<CADDY | sudo tee "`$CADDY_SITE" >/dev/null
# ticktick-mcp-bridge managed block
`$DOMAIN {
`$TLS_LINE
  reverse_proxy 127.0.0.1:8787
}
CADDY
  sudo caddy validate --config /etc/caddy/Caddyfile
  sudo systemctl enable --now caddy
  sudo systemctl reload caddy
elif [ "`$SELECTED_REVERSE_PROXY" = "nginx" ]; then
  if [ "`$STAGING_SELF_SIGNED" = "True" ]; then
    sudo mkdir -p /etc/nginx/ticktick-mcp-bridge
    if [ ! -f /etc/nginx/ticktick-mcp-bridge/selfsigned.key ] || [ ! -f /etc/nginx/ticktick-mcp-bridge/selfsigned.crt ]; then
      sudo openssl req -x509 -nodes -newkey rsa:2048 -days 14 \
        -keyout /etc/nginx/ticktick-mcp-bridge/selfsigned.key \
        -out /etc/nginx/ticktick-mcp-bridge/selfsigned.crt \
        -subj "/CN=`$DOMAIN"
    fi
    NGINX_TLS_LINES="  ssl_certificate /etc/nginx/ticktick-mcp-bridge/selfsigned.crt;
  ssl_certificate_key /etc/nginx/ticktick-mcp-bridge/selfsigned.key;"
  elif [ -n "`$NGINX_SSL_CERTIFICATE" ] && [ -n "`$NGINX_SSL_CERTIFICATE_KEY" ]; then
    NGINX_TLS_LINES="  ssl_certificate `$NGINX_SSL_CERTIFICATE;
  ssl_certificate_key `$NGINX_SSL_CERTIFICATE_KEY;"
  else
    echo "Nginx reverse proxy mode needs -StagingSelfSigned for staging or -NginxSslCertificatePath plus -NginxSslCertificateKeyPath for trusted TLS." >&2
    echo "Use -ReverseProxy manual if an existing Nginx/hosting panel must be configured by hand." >&2
    exit 5
  fi
  cat <<NGINX | sudo tee /etc/nginx/sites-available/ticktick-mcp-bridge.conf >/dev/null
# ticktick-mcp-bridge managed server
server {
  listen 443 ssl http2;
  server_name `$DOMAIN;
`$NGINX_TLS_LINES

  location / {
    proxy_http_version 1.1;
    proxy_set_header Host \`$host;
    proxy_set_header X-Forwarded-For \`$proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto https;
    proxy_pass http://127.0.0.1:8787;
  }
}
NGINX
  sudo ln -sfn /etc/nginx/sites-available/ticktick-mcp-bridge.conf /etc/nginx/sites-enabled/ticktick-mcp-bridge.conf
  sudo nginx -t
  sudo systemctl enable --now nginx
  sudo systemctl reload nginx
else
  echo "Reverse proxy config skipped. Configure HTTPS proxy to http://127.0.0.1:8787 manually."
fi
"@

Write-Host "==> Installing systemd service and reverse proxy config"
Invoke-RemoteScript $remoteService

if (-not $SkipExternalHealthCheck) {
  Write-Host "==> Checking public HTTPS health endpoint"
  if ($AllowSelfSignedHealthCheck -or $StagingSelfSigned) {
    $healthJson = & curl.exe -k -fsS --max-time 30 "$publicBaseUrl/health"
    if ($LASTEXITCODE -ne 0) {
      Write-Warning "Self-signed HTTPS health check failed. Check DNS/LAN routing, firewall, reverse proxy, and service status."
    } else {
      $health = $healthJson | ConvertFrom-Json
      Write-Host ("Health ok: {0}; tools: {1}" -f $health.ok, $health.tools.Count)
    }
  } else {
    try {
      $health = Invoke-RestMethod -Uri "$publicBaseUrl/health" -TimeoutSec 30
      Write-Host ("Health ok: {0}; tools: {1}" -f $health.ok, $health.tools.Count)
    } catch {
      Write-Warning "Public health check failed. DNS, firewall, port 80/443, or TLS issuance may still need time/fixing."
      Write-Warning $_.Exception.Message
    }
  }
}

Write-Host ""
Write-Host "Deployment helper finished."
Write-Host ""
Write-Host "TickTick Developer App:"
Write-Host "  OAuth redirect URL: $tickTickRedirectUri"
Write-Host ""
Write-Host "Authorize TickTick after saving the redirect URL:"
Write-Host "  $publicBaseUrl/oauth/start"
Write-Host ""
Write-Host "ChatGPT connector/app settings:"
Write-Host "  MCP server URL:    $publicBaseUrl/mcp"
Write-Host "  Authentication:    OAuth"
Write-Host "  Authorization URL: $publicBaseUrl/oauth/authorize"
Write-Host "  Token URL:         $publicBaseUrl/oauth/token"
Write-Host "  Client ID:         $ChatGptOAuthClientId"
Write-Host "  Client secret:     $chatGptSecretPlain"
Write-Host "  Scopes:            ticktick:read ticktick:write"
Write-Host "                     If ChatGPT only offers presets, choose default/standard/post."
if ($StagingSelfSigned) {
  Write-Host ""
  Write-Host "Staging note: this run used self-signed/internal TLS. Browser/curl smoke can work, but ChatGPT connector generally requires publicly trusted HTTPS."
}
Write-Host ""
Write-Host "Optional direct bearer smoke value:"
Write-Host "  APP_SHARED_SECRET: $appSharedSecretPlain"
Write-Host ""
Write-Host "Security note: this is a single-user server. Secrets were written only to the VPS .env file and printed here for your setup. Store them in a password manager."
