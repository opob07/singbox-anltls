#!/bin/sh
# Snell Server 零交互一键安装
# 封装 https://git.io/Snell.sh，原脚本 6 个提问（端口/密钥/obfs/ipv6/tfo/dns）
# 全部用默认值自动回答，全程无需键盘输入。
#
# 用法：
#   curl -fsSL https://raw.githubusercontent.com/opob07/singbox-anltls/main/install-snell-auto.sh -o s.sh && sh s.sh
#   （默认 v6 + 10000~60000 随机端口 + 随机密钥，全程零交互）
#   SNELL_VER=4 SNELL_PORT=2345 SNELL_PSK=自定义密钥 sh s.sh
#
# 环境变量（可选）：
#   SNELL_VER   4 / 5 / 6，默认 6
#   SNELL_PORT  监听端口，默认 10000~60000 随机
#   SNELL_PSK   密钥，默认随机生成（v6 会生成 20 位）
#
# 注意（NAT 机）：
#   Snell 监听的是内网端口，客户端要连 NAT 面板映射出去的外部端口（TCP）。

SNELL_SRC="https://git.io/Snell.sh"

case "${SNELL_VER:-6}" in
  4) FULL_VER="4.1.1" ;;
  5) FULL_VER="5.0.1" ;;
  6) FULL_VER="6.0.0rc2" ;;
  *) echo "错误：SNELL_VER 只支持 4 / 5 / 6" >&2; exit 1 ;;
esac

if [ "$(id -u)" -ne 0 ]; then
  echo "错误：请用 root 运行" >&2
  exit 1
fi

echo "==> 下载 Snell 一键脚本..."
if command -v wget >/dev/null 2>&1; then
  wget -O snell.sh --no-check-certificate "$SNELL_SRC" || exit 1
elif command -v curl >/dev/null 2>&1; then
  curl -fsSL -o snell.sh "$SNELL_SRC" || exit 1
else
  echo "错误：找不到 wget 或 curl" >&2
  exit 1
fi
chmod +x snell.sh

echo "==> 开始零交互安装 Snell v${FULL_VER} ..."
# 端口：未指定时 10000~60000 随机
if [ -z "${SNELL_PORT:-}" ]; then
  SNELL_PORT=$(awk 'BEGIN{srand(); print int(rand()*50001)+10000}')
fi
echo "==> 端口: ${SNELL_PORT}"
# 依次回答：端口 / 密钥 / obfs / ipv6 / tfo / dns（空行 = 默认值）
printf '%s\n%s\n\n\n\n\n\n\n\n\n\n' "${SNELL_PORT}" "${SNELL_PSK:-}" | ./snell.sh "$FULL_VER"
rc=$?
rm -f snell.sh
[ $rc -ne 0 ] && { echo "安装过程出错（exit $rc）" >&2; exit $rc; }

# 从配置文件读出实际端口和密钥，打印 Surge 行
CONF="/etc/snell/snell-server.conf"
if [ -f "$CONF" ]; then
  PORT=$(grep -E '^listen' "$CONF" | head -1 | sed 's/.*://;s/,.*//')
  PSK=$(grep -E '^psk' "$CONF" | head -1 | sed 's/^psk *= *//')
  PUBIP=$(curl -s --max-time 8 ifconfig.me 2>/dev/null || echo "<服务器IP>")
  MAJOR=$(echo "$FULL_VER" | cut -d. -f1)
  echo
  echo "=============================="
  echo "Snell 安装完成，Surge 配置行："
  echo "Snell-${MAJOR} = snell, ${PUBIP}, ${PORT}, psk=${PSK}, version=${MAJOR}"
  echo "=============================="
  echo "NAT 机请把 ${PUBIP} 换成 NAT 面板给的外部 IP，端口换成映射的外部端口（TCP）。"
fi
