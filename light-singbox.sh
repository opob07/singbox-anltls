#!/bin/sh
# light-singbox.sh — 轻量 sing-box 一键脚本 (64M 小内存 VPS 可用)
# 支持 Alpine / Debian / Ubuntu，amd64 / arm64，systemd / OpenRC
# 用法：curl -fsSL <地址>/light-singbox.sh -o s.sh && sh s.sh
set -e

[ "$(id -u)" -ne 0 ] && { echo "请用 root 运行"; exit 1; }

echo "=== 轻量 sing-box 一键脚本 ==="

# --- 架构 ---
case "$(uname -m)" in
    x86_64|amd64) SB_ARCH="amd64" ;;
    aarch64|arm64) SB_ARCH="arm64" ;;
    *) echo "不支持的架构: $(uname -m)"; exit 1 ;;
esac

# --- 系统 ---
if [ -f /etc/alpine-release ]; then
    OS="alpine"
elif [ -f /etc/debian_version ]; then
    OS="debian"
else
    echo "仅支持 Alpine / Debian / Ubuntu"; exit 1
fi
echo "系统: $OS / $SB_ARCH"

# --- 依赖 (只装必需的) ---
echo "--- 安装依赖 ---"
if [ "$OS" = "alpine" ]; then
    apk add --no-cache curl openssl >/dev/null 2>&1
else
    apt-get update -qq >/dev/null 2>&1
    DEBIAN_FRONTEND=noninteractive apt-get install -y -qq curl openssl >/dev/null 2>&1
fi

# --- 协议选择 ---
echo ""
echo "选择协议:"
echo "  1) AnyTLS       (默认, TCP)"
echo "  2) TUIC         (UDP, 最省内存)"
echo "  3) VLESS+Reality (TCP, 无需域名证书)"
echo "  4) Hysteria2    (UDP, 速度快)"
printf "输入序号 [1]: "
read -r CHOICE
CHOICE=${CHOICE:-1}

# --- 随机参数 ---
PORT=$(shuf -i 10000-65535 -n 1 2>/dev/null || awk 'BEGIN{srand(); print int(10000+rand()*55535)}')
UUID=$(cat /proc/sys/kernel/random/uuid 2>/dev/null || echo "00000000-0000-0000-0000-000000000000")
PASSWD=$(head -c 12 /dev/urandom | od -An -tx1 | tr -d ' \n')
SNI="www.bing.com"
IP=$(curl -fsSL -4 --max-time 10 ifconfig.me 2>/dev/null || curl -fsSL -4 --max-time 10 ip.sb 2>/dev/null || echo "你的服务器IP")

# --- 下载 sing-box ---
echo ""
echo "--- 下载 sing-box ---"
VERSION=$(curl -fsSL --max-time 20 https://api.github.com/SagerNet/sing-box/releases/latest | grep '"tag_name"' | head -1 | cut -d'"' -f4)
[ -z "$VERSION" ] && { echo "获取版本失败"; exit 1; }
echo "最新版本: $VERSION"
cd /tmp
curl -fsSL --max-time 120 -o sb.tgz "https://github.com/SagerNet/sing-box/releases/download/${VERSION}/sing-box-${VERSION#v}-linux-${SB_ARCH}.tar.gz"
tar xzf sb.tgz
install -m 755 sing-box-${VERSION#v}-linux-${SB_ARCH}/sing-box /usr/local/bin/sing-box
rm -rf sb.tgz sing-box-${VERSION#v}-linux-${SB_ARCH}
mkdir -p /etc/sing-box

# --- 生成配置 ---
echo "--- 生成配置 ---"
case "$CHOICE" in
    2) PROTO="tuic" ;;
    3) PROTO="vless" ;;
    4) PROTO="hy2" ;;
    *) PROTO="anytls"; CHOICE=1 ;;
esac

# 自签证书 (tuic/hy2/anytls 需要)
if [ "$PROTO" != "vless" ]; then
    openssl req -x509 -newkey rsa:2048 -keyout /etc/sing-box/key.pem \
        -out /etc/sing-box/cert.pem -days 3650 -nodes \
        -subj "/CN=${SNI}" >/dev/null 2>&1
    chmod 600 /etc/sing-box/key.pem
fi

if [ "$PROTO" = "tuic" ]; then
    cat > /etc/sing-box/config.json <<EOF
{
  "log": { "level": "warn" },
  "inbounds": [{
    "type": "tuic", "tag": "tuic-in",
    "listen": "::", "listen_port": $PORT,
    "users": [{ "uuid": "$UUID", "password": "$PASSWD" }],
    "congestion_control": "bbr",
    "tls": {
      "enabled": true, "server_name": "$SNI", "alpn": ["h3"],
      "certificate_path": "/etc/sing-box/cert.pem",
      "key_path": "/etc/sing-box/key.pem"
    }
  }],
  "outbounds": [{ "type": "direct", "tag": "direct" }]
}
EOF
    SURGE="TUIC = tuic, ${IP}, ${PORT}, password=${PASSWD}, uuid=${UUID}, sni=${SNI}, skip-cert-verify=true, congestion-controller=bbr, alpn=h3"
elif [ "$PROTO" = "vless" ]; then
    KP=$(/usr/local/bin/sing-box generate reality-keypair)
    PRIVKEY=$(echo "$KP" | grep "PrivateKey" | awk '{print $2}')
    PUBKEY=$(echo "$KP" | grep "PublicKey" | awk '{print $2}')
    SHORTID=$(head -c 8 /dev/urandom | od -An -tx1 | tr -d ' \n')
    DEST="www.microsoft.com"
    cat > /etc/sing-box/config.json <<EOF
{
  "log": { "level": "warn" },
  "inbounds": [{
    "type": "vless", "tag": "vless-in",
    "listen": "::", "listen_port": $PORT,
    "users": [{ "uuid": "$UUID", "flow": "xtls-rprx-vision" }],
    "tls": {
      "enabled": true, "server_name": "$DEST",
      "reality": {
        "enabled": true,
        "handshake": { "server": "$DEST", "server_port": 443 },
        "private_key": "$PRIVKEY",
        "short_id": ["$SHORTID"]
      }
    }
  }],
  "outbounds": [{ "type": "direct", "tag": "direct" }]
}
EOF
    SURGE="VLESS = vless, ${IP}, ${PORT}, username=${UUID}, tls=true, sni=${DEST}, flow=xtls-rprx-vision"
    # Surge 的 VLESS Reality 需另填 reality 公钥/short-id，下方 URI 链接通用客户端可直接导入
    LINK="vless://${UUID}@${IP}:${PORT}?encryption=none&flow=xtls-rprx-vision&security=reality&sni=${DEST}&fp=chrome&pbk=${PUBKEY}&sid=${SHORTID}#singbox-vless"
elif [ "$PROTO" = "hy2" ]; then
    cat > /etc/sing-box/config.json <<EOF
{
  "log": { "level": "warn" },
  "inbounds": [{
    "type": "hysteria2", "tag": "hy2-in",
    "listen": "::", "listen_port": $PORT,
    "users": [{ "password": "$PASSWD" }],
    "tls": {
      "enabled": true, "server_name": "$SNI", "alpn": ["h3"],
      "certificate_path": "/etc/sing-box/cert.pem",
      "key_path": "/etc/sing-box/key.pem"
    }
  }],
  "outbounds": [{ "type": "direct", "tag": "direct" }]
}
EOF
    SURGE="HY2 = hysteria2, ${IP}, ${PORT}, password=${PASSWD}, sni=${SNI}, skip-cert-verify=true"
else
    cat > /etc/sing-box/config.json <<EOF
{
  "log": { "level": "warn" },
  "inbounds": [{
    "type": "anytls", "tag": "anytls-in",
    "listen": "::", "listen_port": $PORT,
    "users": [{ "password": "$PASSWD" }],
    "tls": {
      "enabled": true, "server_name": "$SNI",
      "certificate_path": "/etc/sing-box/cert.pem",
      "key_path": "/etc/sing-box/key.pem"
    }
  }],
  "outbounds": [{ "type": "direct", "tag": "direct" }]
}
EOF
    SURGE="AnyTLS = anytls, ${IP}, ${PORT}, password=${PASSWD}, sni=${SNI}, skip-cert-verify=true"
fi

# --- 服务 ---
echo "--- 注册服务 ---"
/usr/local/bin/sing-box check -c /etc/sing-box/config.json || { echo "配置校验失败"; exit 1; }
if [ "$OS" = "alpine" ]; then
    cat > /etc/init.d/sing-box <<'EOF'
#!/sbin/openrc-run
name="sing-box"
command="/usr/local/bin/sing-box"
command_args="run -c /etc/sing-box/config.json"
command_background="yes"
pidfile="/run/sing-box.pid"
depend() { need net; after firewall; }
EOF
    chmod +x /etc/init.d/sing-box
    rc-update add sing-box default >/dev/null 2>&1
    rc-service sing-box restart >/dev/null 2>&1
else
    cat > /etc/systemd/system/sing-box.service <<'EOF'
[Unit]
Description=sing-box
After=network.target

[Service]
ExecStart=/usr/local/bin/sing-box run -c /etc/sing-box/config.json
Restart=always
RestartSec=5
LimitNOFILE=51200
# 64M 小内存：降低被 OOM killer 选中的概率
OOMScoreAdjust=-200

[Install]
WantedBy=multi-user.target
EOF
    systemctl daemon-reload
    systemctl enable --now sing-box >/dev/null 2>&1
fi

# --- BBR (尽量开) ---
sysctl -w net.core.default_qdisc=fq >/dev/null 2>&1
sysctl -w net.ipv4.tcp_congestion_control=bbr >/dev/null 2>&1 || true

echo ""
echo "================ 安装完成 ================"
echo "协议: $PROTO | 端口: $PORT"
echo ""
echo "Surge 配置 (复制到 [Proxy] 下):"
echo "$SURGE"
if [ -n "${LINK:-}" ]; then
echo ""
echo "通用分享链接 (VLESS Reality 建议用此导入):"
echo "$LINK"
fi
echo ""
echo "注意: 云防火墙/安全组记得放行 $PORT (UDP 协议选 UDP, TCP 协议选 TCP)"
echo "内存占用: sing-box 空载约 10-20M，64M 机器够用"
echo "=========================================="
