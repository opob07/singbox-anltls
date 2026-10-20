#!/bin/sh
# Snell Server 零交互一键安装（全自动状态识别）
# 封装 https://git.io/Snell.sh，原脚本 6 个提问（端口/密钥/obfs/ipv6/tfo/dns）
# 全部用默认值自动回答，全程无需键盘输入。
#
# 用法：
#   curl -fsSL "https://raw.githubusercontent.com/opob07/singbox-anltls/main/install-snell-auto.sh?t=$(date +%s)" -o s.sh && sh s.sh
#   （下载带 t= 参数，绕开 raw.githubusercontent 的缓存）
#
# 环境变量（可选）：
#   SNELL_VER   4 / 5 / 6，默认 6
#   SNELL_PORT  监听端口，默认 10000~60000 随机
#   SNELL_PSK   密钥，默认随机生成（v6 会生成 20 位）
#   SNELL_FORCE=1  无条件强制重装（删二进制+配置，慎用）
#
# 自动识别四种状态：
#   1. 没装过            → 直接安装
#   2. 二进制在、配置不在 → 损坏的残留 → 自动清理并重装
#   3. 配置在、二进制不在 → 损坏的残留 → 自动清理并重装
#   4. 二进制+配置都在    → 视为已安装 → 直接打印现有 Surge 配置，不折腾
#
# 注意（NAT 机）：
#   Snell 监听的是内网端口，客户端要连 NAT 面板映射出去的外部端口（TCP）。
#
# 快捷指令：
#   安装完成后可直接输入 snell 进入 Snell 管理控制台（安装/卸载/改配置/看状态）。
#   支持传参直达菜单项，如 snell 7 查看配置、snell 8 查看状态。

SNELL_SRC="https://git.io/Snell.sh"
BIN="/usr/local/bin/snell-server"
CONF="/etc/snell/config.conf"

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

# 从配置文件读出端口/psk/版本，打印 Surge 配置行
print_surge_line() {
  if [ ! -f "$CONF" ]; then
    echo "错误：配置文件 $CONF 不存在" >&2
    return 1
  fi
  PORT=$(grep -E '^listen' "$CONF" | head -1 | sed 's/.*://;s/,.*//')
  PSK=$(grep -E '^psk' "$CONF" | head -1 | sed 's/^psk *= *//')
  VER=$(grep -E '^version' "$CONF" | head -1 | sed 's/^version *= *//')
  TFO=$(grep -E '^tfo' "$CONF" | head -1 | sed 's/^tfo *= *//')
  MODE=$(grep -E '^mode' "$CONF" | head -1 | sed 's/^mode *= *//')
  MAJOR=$(echo "$VER" | cut -d. -f1)
  [ -z "$MAJOR" ] && MAJOR="${SNELL_VER:-6}"
  # 拼接 Surge 完整参数：tfo 取服务端配置；v6 带 mode；v4+ 开连接复用；ecn 照抄常用写法
  PARAMS="version=${MAJOR}"
  [ -n "$TFO" ] && PARAMS="${PARAMS}, tfo=${TFO}"
  if [ "$MAJOR" -ge 6 ] 2>/dev/null && [ -n "$MODE" ]; then
    PARAMS="${PARAMS}, mode=${MODE}"
  fi
  if [ "$MAJOR" -ge 4 ] 2>/dev/null; then
    PARAMS="${PARAMS}, reuse=true"
  fi
  PARAMS="${PARAMS}, ecn=true"
  PUBIP=$(curl -s --max-time 8 ifconfig.me 2>/dev/null || echo "<服务器IP>")
  echo
  echo "=============================="
  echo "Snell 配置信息："
  echo "  版本: v${VER:-$FULL_VER}"
  echo "  端口: ${PORT}"
  echo "  密钥: ${PSK}"
  echo
  echo "Surge 配置行："
  echo "Snell-${MAJOR} = snell, ${PUBIP}, ${PORT}, psk=${PSK}, ${PARAMS}"
  echo "=============================="
  echo "NAT 机请把 ${PUBIP} 换成 NAT 面板给的外部 IP，端口换成映射的外部端口（TCP）。"
}

# 停服务、删二进制和配置
cleanup() {
  rc-service snell-server stop >/dev/null 2>&1 || true
  systemctl stop snell-server >/dev/null 2>&1 || true
  systemctl disable snell-server >/dev/null 2>&1 || true
  rm -f "$BIN"
  rm -rf /etc/snell
  mkdir -p /etc/snell
}

# 安装/刷新 snell 快捷指令（/usr/local/bin/snell → 管理控制台）
# $1: 已下载的 snell.sh 路径（可选；不给则按需下载）
ensure_shortcut() {
  if [ -n "${1:-}" ]; then
    cp -f "$1" /usr/local/bin/snell
    chmod +x /usr/local/bin/snell
    echo "==> 快捷指令已就绪：输入 snell 进入管理控制台"
  elif [ ! -x /usr/local/bin/snell ]; then
    echo "==> 安装 snell 快捷指令..."
    if command -v wget >/dev/null 2>&1; then
      wget -q -O /usr/local/bin/snell --no-check-certificate "$SNELL_SRC" || return 1
    elif command -v curl >/dev/null 2>&1; then
      curl -fsSL -o /usr/local/bin/snell "$SNELL_SRC" || return 1
    else
      echo "警告：找不到 wget/curl，快捷指令未安装" >&2
      return 1
    fi
    chmod +x /usr/local/bin/snell
    echo "==> 快捷指令已就绪：输入 snell 进入管理控制台"
  fi
}

do_install() {
  echo "==> 下载 Snell 一键脚本..."
  if command -v wget >/dev/null 2>&1; then
    wget -O snell.sh --no-check-certificate "$SNELL_SRC" || return 1
  elif command -v curl >/dev/null 2>&1; then
    curl -fsSL -o snell.sh "$SNELL_SRC" || return 1
  else
    echo "错误：找不到 wget 或 curl" >&2
    return 1
  fi
  chmod +x snell.sh
  ensure_shortcut snell.sh

  # 修复上游 bug：带版本号参数安装（./snell.sh x.y.z）会跳过 installSnell()，
  # 导致 /etc/snell/ 目录没被创建、写配置文件失败。先自己建好。
  mkdir -p /etc/snell

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
  if [ $rc -ne 0 ]; then
    echo "安装过程出错（exit $rc）" >&2
    return $rc
  fi
  print_surge_line
}

if [ "${SNELL_FORCE:-0}" = "1" ]; then
  echo "==> 强制重装：清理旧安装..."
  cleanup
  do_install
elif [ -e "$BIN" ] && [ -e "$CONF" ]; then
  echo "==> 检测到 Snell 已完整安装，沿用现有配置："
  ensure_shortcut || true
  print_surge_line
elif [ -e "$BIN" ] || [ -e "$CONF" ]; then
  echo "==> 检测到损坏的残留安装，自动清理并重装..."
  cleanup
  do_install
else
  echo "==> 未检测到 Snell，开始全新安装..."
  do_install
fi
