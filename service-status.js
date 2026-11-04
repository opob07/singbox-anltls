// 服务状态面板脚本 · Surge generic script
// 检测当前出站节点对 13 个服务的连通性，结果显示在 [Panel] 里。
// 第一行用 $surge.selectGroupDetails() 取 select 策略组的选中节点，
// 显示在出口 IP 上面；Surge 里没有单一的“当前节点”，规则模式下
// 每个域名走的策略组可能不同，这里显示的是所选策略组解析到底的节点。
// 写法按 Surge 官方手册：$httpClient.get 回调 + $done({title, content, style})
// ES5 写法，无 async/await，无箭头函数，无模板字符串，兼容 JavaScriptCore 引擎。

var UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";

var SERVICES = [
  { name: "Google", url: "https://www.google.com/generate_204", kind: "google" },
  { name: "GitHub", url: "https://api.github.com", kind: "generic" },
  { name: "YouTube", url: "https://www.youtube.com/", kind: "generic" },
  { name: "ChatGPT", url: "https://chatgpt.com/", kind: "generic" },
  { name: "Claude", url: "https://claude.ai/", kind: "generic" },
  { name: "Gemini", url: "https://gemini.google.com/", kind: "generic" },
  { name: "Netflix", url: "https://www.netflix.com/title/81215567", kind: "netflix" },
  { name: "Disney+", url: "https://www.disneyplus.com/", kind: "generic" },
  { name: "Prime Video", url: "https://www.primevideo.com/", kind: "generic" },
  { name: "Spotify", url: "https://www.spotify.com/", kind: "generic" },
  { name: "TikTok", url: "https://www.tiktok.com/", kind: "generic" },
  { name: "Discord", url: "https://discord.com/", kind: "generic" },
  { name: "Bilibili", url: "https://www.bilibili.com/", kind: "generic" }
];

var results = [];
var pending = SERVICES.length + 1;
var exitIp = "";
var exitCountry = "";
var finished = false;
var i;

for (i = 0; i < SERVICES.length; i++) {
  results.push({ state: "fail", ms: 0, note: "待检测" });
}

function getArgumentValue(key) {
  var parts;
  var j;
  var kv;
  try {
    if (typeof $argument === "undefined" || !$argument) return "";
    if (typeof $argument === "object") return $argument[key] || "";
    parts = String($argument).split("&");
    for (j = 0; j < parts.length; j++) {
      kv = parts[j].split("=");
      if (kv.length >= 2 && kv[0] === key) return decodeURIComponent(kv.slice(1).join("="));
    }
  } catch (e) {
    return "";
  }
  return "";
}

function resolveChain(groupName, decisions) {
  var cur = decisions[groupName];
  var seen = {};
  var steps = [groupName];
  while (cur && decisions[cur] && !seen[cur]) {
    seen[cur] = true;
    steps.push(cur);
    cur = decisions[cur];
  }
  return { leaf: cur || "", steps: steps };
}

function resolveNodeLabel() {
  var details;
  var decisions;
  var wanted;
  var preferred = ["Proxy", "默认代理", "FINAL", "Final", "GLOBAL", "Global", "♻️自动选择", "自动选择", "主策略"];
  var p;
  var k;
  var val;
  var chain;
  try {
    if (typeof $surge === "undefined" || !$surge.selectGroupDetails) return "";
    details = $surge.selectGroupDetails();
    if (!details || !details.decisions) return "";
    decisions = details.decisions;
    wanted = getArgumentValue("group");
    if (wanted && decisions[wanted]) {
      chain = resolveChain(wanted, decisions);
      if (chain.leaf) return chain.leaf + (chain.steps.length > 1 ? " · " + chain.steps.join(" → ") : "");
      return "";
    }
    for (p = 0; p < preferred.length; p++) {
      if (decisions[preferred[p]]) {
        chain = resolveChain(preferred[p], decisions);
        if (chain.leaf) return chain.leaf + (chain.steps.length > 1 ? " · " + chain.steps.join(" → ") : "");
      }
    }
    for (k in decisions) {
      if (!decisions.hasOwnProperty(k)) continue;
      val = decisions[k];
      if (val && val !== "DIRECT" && val !== "REJECT" && !decisions[val]) {
        chain = resolveChain(k, decisions);
        if (chain.leaf) return chain.leaf + (chain.steps.length > 1 ? " · " + chain.steps.join(" → ") : "");
      }
    }
    for (k in decisions) {
      if (!decisions.hasOwnProperty(k)) continue;
      if (decisions[k]) return decisions[k];
    }
  } catch (e) {
    return "";
  }
  return "";
}

var nodeLabel = "";
try {
  nodeLabel = resolveNodeLabel();
} catch (e) {
  nodeLabel = "";
}

function parseNetflixRegion(response) {
  var url = "";
  var parts;
  if (!response || !response.headers) return "";
  url = response.headers["x-originating-url"] || response.headers["X-Originating-Url"] || "";
  if (!url) return "";
  parts = url.split("/");
  // https://www.netflix.com/us/title/81215567 -> parts[3] = "us"
  // https://www.netflix.com/title/81215567 -> parts[3] = "title"，视为 us
  if (parts.length > 3 && parts[3] !== "title" && parts[3] !== "") return parts[3];
  if (parts.length > 3 && parts[3] === "title") return "us";
  return "";
}

function judge(idx, error, response, ms) {
  var svc = SERVICES[idx];
  var status = response ? response.status : 0;
  var region = "";
  var r = { state: "fail", ms: ms, note: "" };
  if (error) {
    r.note = "请求失败";
    results[idx] = r;
    return;
  }
  if (svc.kind === "google") {
    if (status === 204 || status === 200) {
      r.state = "ok";
    } else {
      r.note = "HTTP " + status;
    }
    results[idx] = r;
    return;
  }
  if (svc.kind === "netflix") {
    if (status === 403) {
      r.note = "HTTP 403 不可用";
      results[idx] = r;
      return;
    }
    if (status === 404) {
      r.state = "partial";
      r.note = "仅自制剧";
      results[idx] = r;
      return;
    }
    if (status === 200) {
      region = parseNetflixRegion(response);
      r.state = "ok";
      if (region) r.note = "解锁区域 " + region.toUpperCase();
      results[idx] = r;
      return;
    }
    r.note = "HTTP " + status;
    results[idx] = r;
    return;
  }
  // generic
  if (status >= 200 && status < 400) {
    r.state = "ok";
  } else if (status === 403) {
    r.note = "HTTP 403 已拦截";
  } else if (status === 0) {
    r.note = "无响应";
  } else {
    r.note = "HTTP " + status;
  }
  results[idx] = r;
}

function finish() {
  var lines = [];
  var okCount = 0;
  var style = "error";
  var title = "";
  var j;
  var icon;
  if (finished) return;
  finished = true;
  for (j = 0; j < results.length; j++) {
    if (results[j].state === "ok") okCount++;
  }
  if (nodeLabel) {
    lines.push("当前节点: " + nodeLabel);
  } else {
    lines.push("当前节点: 未知");
  }
  if (exitIp) {
    if (exitCountry) {
      lines.push("出口 IP: " + exitIp + " (" + exitCountry + ")");
    } else {
      lines.push("出口 IP: " + exitIp);
    }
  } else {
    lines.push("出口 IP: 获取失败");
  }
  for (j = 0; j < SERVICES.length; j++) {
    if (results[j].state === "ok") icon = "✅";
    else if (results[j].state === "partial") icon = "⚠️";
    else icon = "❌";
    if (results[j].state === "ok" && !results[j].note) {
      lines.push(icon + " " + SERVICES[j].name + " " + results[j].ms + "ms");
    } else if (results[j].note) {
      lines.push(icon + " " + SERVICES[j].name + " " + results[j].ms + "ms · " + results[j].note);
    } else {
      lines.push(icon + " " + SERVICES[j].name + " " + results[j].ms + "ms");
    }
  }
  title = "服务状态 " + okCount + "/" + SERVICES.length + " 可用";
  if (okCount === SERVICES.length) style = "good";
  else if (okCount >= 9) style = "info";
  else if (okCount >= 5) style = "alert";
  else style = "error";
  $done({ title: title, content: lines.join("\n"), style: style });
}

function checkOne(idx) {
  var start = Date.now();
  $httpClient.get(
    { url: SERVICES[idx].url, timeout: 8, headers: { "User-Agent": UA } },
    function (error, response, data) {
      judge(idx, error, response, Date.now() - start);
      pending--;
      if (pending <= 0) finish();
    }
  );
}

function checkIp() {
  $httpClient.get(
    { url: "https://api.ipify.org", timeout: 8 },
    function (error, response, data) {
      if (!error && response && response.status === 200 && data) {
        exitIp = String(data).trim();
        try {
          if (typeof $utils !== "undefined" && $utils.geoip) {
            exitCountry = $utils.geoip(exitIp) || "";
          }
        } catch (e) {
          exitCountry = "";
        }
      }
      pending--;
      if (pending <= 0) finish();
    }
  );
}

try {
  for (i = 0; i < SERVICES.length; i++) {
    checkOne(i);
  }
  checkIp();
  setTimeout(function () {
    if (!finished) finish();
  }, 12000);
} catch (e) {
  $done({ title: "服务状态", content: "脚本异常: " + e, style: "error" });
}
