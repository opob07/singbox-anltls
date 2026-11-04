// 服务状态面板脚本 · Surge generic script
// 检测当前出站节点对 13 个服务的连通性，结果显示在 [Panel] 里。
// 检测方式按 FlClash（chen08209/FlClash core/service_rules.go）改写：
// 每个服务用自己的专用接口 + 正文/地区判断，不再只看首页状态码。
// 例外：Disney+ 的完整握手需要 Disney 浏览器令牌 + 3 次 POST，
// 为避免把令牌写进公开仓库，这里只用首页正文里的 countryCode /
// inSupportedLocation 判断，见 checkDisney。
// 第一行用 $surge.selectGroupDetails() 取 select 策略组的选中节点。
// ES5 写法，无 async/await，无箭头函数，无模板字符串，兼容 JavaScriptCore 引擎。

// FlClash 探针用的浏览器 UA（core/outbound_ip.go browserUserAgent）。
var UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

var SERVICES = [
  { name: "Google", icon: "ⓖ", kind: "google" },
  { name: "GitHub", icon: "🐙", kind: "github" },
  { name: "YouTube", icon: "▶️", kind: "youtube" },
  { name: "ChatGPT", icon: "🤖", kind: "chatgpt" },
  { name: "Claude", icon: "🔶", kind: "claude" },
  { name: "Gemini", icon: "✨", kind: "gemini" },
  { name: "Netflix", icon: "🅽", kind: "netflix" },
  { name: "Disney+", icon: "🏰", kind: "disney" },
  { name: "Prime Video", icon: "🎞️", kind: "prime" },
  { name: "Spotify", icon: "🟢", kind: "spotify" },
  { name: "TikTok", icon: "🎶", kind: "tiktok" },
  { name: "Discord", icon: "🎮", kind: "discord" },
  { name: "Bilibili", icon: "📺", kind: "bilibili" }
];

var CLAUDE_BLOCKED = ["AF", "BY", "CN", "CU", "HK", "IR", "KP", "MO", "RU", "SY"];
var GEMINI_BLOCKED = ["CHN", "RUS", "BLR", "CUB", "IRN", "PRK", "SYR", "HKG", "MAC"];

var ISO3_TO_2 = {
  USA: "US", JPN: "JP", KOR: "KR", SGP: "SG", AUS: "AU", CAN: "CA",
  GBR: "GB", DEU: "DE", FRA: "FR", ITA: "IT", ESP: "ES", NLD: "NL",
  CHN: "CN", RUS: "RU", BLR: "BY", CUB: "CU", IRN: "IR", PRK: "KP",
  SYR: "SY", HKG: "HK", MAC: "MO", TWN: "TW", IND: "IN", BRA: "BR",
  MEX: "MX", TUR: "TR", SAU: "SA", ARE: "AE", ZAF: "ZA", NZL: "NZ",
  SWE: "SE", NOR: "NO", DNK: "DK", FIN: "FI", POL: "PL", CHE: "CH",
  AUT: "AT", BEL: "BE", IRL: "IE", PRT: "PT", GRC: "GR", CZE: "CZ",
  HUN: "HU", ROU: "RO", UKR: "UA", ISR: "IL", EGY: "EG", NGA: "NG",
  KEN: "KE", ARG: "AR", CHL: "CL", COL: "CO", PER: "PE", PHL: "PH",
  IDN: "ID", MYS: "MY", THA: "TH", VNM: "VN", PAK: "PK", BGD: "BD"
};

var results = [];
var pending = SERVICES.length + 1;
var exitIp = "";
var exitCountry = "";
var finished = false;
var i;

for (i = 0; i < SERVICES.length; i++) {
  results.push({ state: "fail", ms: 0, note: "待检测" });
}

function bodyText(data) {
  return data ? String(data) : "";
}

function lowerText(s) {
  return String(s || "").toLowerCase();
}

function containsText(body, needle) {
  return lowerText(body).indexOf(lowerText(needle)) >= 0;
}

function firstMatch(body, pattern) {
  var m = pattern.exec(String(body || ""));
  if (m && m.length > 1) return m[1];
  return "";
}

function getHeader(response, name) {
  var headers;
  var key;
  var want = String(name).toLowerCase();
  if (!response || !response.headers) return "";
  headers = response.headers;
  for (key in headers) {
    if (headers.hasOwnProperty(key) && String(key).toLowerCase() === want) return headers[key];
  }
  return "";
}

function isAsciiUpper(s) {
  var j;
  for (j = 0; j < s.length; j++) {
    if (s.charAt(j) < "A" || s.charAt(j) > "Z") return false;
  }
  return s.length > 0;
}

// FlClash normalizeRegion：2 位直接取，3 位按 ISO 3166 换算成 2 位。
function normalizeRegion(code) {
  var c = String(code || "").replace(/^\s+|\s+$/g, "").toUpperCase();
  if (c.length === 2) {
    return isAsciiUpper(c) ? c : "";
  }
  if (c.length === 3) {
    if (!isAsciiUpper(c)) return "";
    if (ISO3_TO_2[c]) return ISO3_TO_2[c];
    return c;
  }
  return "";
}

function inList(value, list) {
  var j;
  for (j = 0; j < list.length; j++) {
    if (list[j] === value) return true;
  }
  return false;
}

// FlClash statusFromCode：2xx 可用；401/403/429/451 受限；其余不可用。
function statusResult(code) {
  if (code >= 200 && code < 300) return { state: "ok", note: "" };
  if (code === 401 || code === 403 || code === 429 || code === 451) {
    return { state: "partial", note: "受限 (HTTP " + code + ")" };
  }
  if (code === 0) return { state: "fail", note: "无响应" };
  return { state: "fail", note: "HTTP " + code };
}

function parseTraceLoc(data) {
  var lines;
  var j;
  var line;
  if (!data) return "";
  lines = String(data).split("\n");
  for (j = 0; j < lines.length; j++) {
    line = lines[j].replace(/^\s+|\s+$/g, "");
    if (line.indexOf("loc=") === 0) return line.substring(4).replace(/^\s+|\s+$/g, "").toUpperCase();
  }
  return "";
}

function httpGet(url, timeoutSec, noRedirect, cb) {
  var opts = { url: url, timeout: timeoutSec, headers: { "User-Agent": UA } };
  if (noRedirect) opts["auto-redirect"] = false;
  $httpClient.get(opts, function (error, response, data) {
    cb(error, response, bodyText(data));
  });
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

// ---- 各服务检测（FlClash 方式），cb 收到 {state, note} ----

function checkReachable(url) {
  return function (svc, cb) {
    httpGet(url, 8, false, function (error, response, data) {
      if (error) { cb({ state: "fail", note: "请求失败" }); return; }
      cb(statusResult(response ? response.status : 0));
    });
  };
}

function checkYouTube(svc, cb) {
  httpGet("https://www.youtube.com/premium?hl=en", 8, false, function (error, response, data) {
    var status = response ? response.status : 0;
    var raw = firstMatch(data, /id=["']country-code["'][^>]*>\s*([A-Za-z]{2,3})\s*</i)
      || firstMatch(data, /"GL"\s*:\s*"([A-Za-z]{2})"/)
      || firstMatch(data, /"countryCode"\s*:\s*"([A-Za-z]{2})"/)
      || firstMatch(data, /"country_code"\s*:\s*"([A-Za-z]{2})"/);
    var region = normalizeRegion(raw);
    if (error) { cb({ state: "fail", note: "请求失败" }); return; }
    if (containsText(data, "youtube premium is not available in your country")
      || containsText(data, "premium is not available in your country")
      || containsText(data, "premium is not available in your region")) {
      cb({ state: "partial", note: "地区不支持" + (region ? " (" + region + ")" : "") });
      return;
    }
    if (status >= 200 && status < 300
      && (containsText(data, "youtube premium") || containsText(data, "ad-free") || containsText(data, "\"browseid\":\"spunlimited\""))) {
      cb({ state: "ok", note: region ? "地区 " + region : "" });
      return;
    }
    var r = statusResult(status);
    if (region) {
      r.note = r.note ? r.note + " (" + region + ")" : "地区 " + region;
    }
    cb(r);
  });
}

function checkChatGpt(svc, cb) {
  var iosStatus = "failed";
  var region = "";
  httpGet("https://ios.chat.openai.com/", 8, false, function (error, response, data) {
    if (error) {
      iosStatus = "failed";
    } else if (containsText(data, "you may be connected to a disallowed isp")) {
      iosStatus = "disallowed";
    } else if (containsText(data, "sorry, you have been blocked")) {
      iosStatus = "blocked";
    } else if (containsText(data, "request is not allowed. please try again later.")) {
      iosStatus = "available";
    } else {
      iosStatus = "failed";
    }
    httpGet("https://chat.openai.com/cdn-cgi/trace", 8, false, function (error2, response2, data2) {
      var loc = "";
      if (!error2) {
        loc = parseTraceLoc(data2);
        if (loc) region = normalizeRegion(loc) || loc;
      }
      httpGet("https://api.openai.com/compliance/cookie_requirements", 8, false, function (error3, response3, data3) {
        var webUnsupported = !error3 && containsText(data3, "unsupported_country");
        var suffix = region ? " (" + region + ")" : "";
        if (webUnsupported) {
          cb({ state: "partial", note: "地区不支持" + suffix });
          return;
        }
        if (iosStatus === "available") {
          cb({ state: "ok", note: region ? "地区 " + region : "" });
          return;
        }
        if (iosStatus === "disallowed") {
          cb({ state: "partial", note: "ISP 不被允许" + suffix });
          return;
        }
        if (iosStatus === "blocked") {
          cb({ state: "fail", note: "已被屏蔽" + suffix });
          return;
        }
        cb({ state: "fail", note: "检测失败" });
      });
    });
  });
}

function checkClaude(svc, cb) {
  httpGet("https://claude.ai/cdn-cgi/trace", 8, false, function (error, response, data) {
    var status = response ? response.status : 0;
    var region = parseTraceLoc(data);
    if (error) { cb({ state: "fail", note: "请求失败" }); return; }
    if (!region) {
      cb({ state: "fail", note: status ? "无地区信息 (HTTP " + status + ")" : "无地区信息" });
      return;
    }
    if (inList(region, CLAUDE_BLOCKED)) {
      cb({ state: "partial", note: "地区不支持 (" + region + ")" });
      return;
    }
    cb({ state: "ok", note: "地区 " + region });
  });
}

function checkGemini(svc, cb) {
  var marker = ",2,1,200,\"";
  httpGet("https://gemini.google.com", 8, false, function (error, response, data) {
    var idx;
    var code3 = "";
    var region = "";
    if (error) { cb({ state: "fail", note: "请求失败" }); return; }
    idx = data.indexOf(marker);
    if (idx < 0 || idx + marker.length + 3 > data.length) {
      cb({ state: "fail", note: "无地区标记" });
      return;
    }
    code3 = data.substr(idx + marker.length, 3);
    if (!/^[A-Z]{3}$/.test(code3)) {
      cb({ state: "fail", note: "无地区标记" });
      return;
    }
    region = normalizeRegion(code3);
    if (inList(code3, GEMINI_BLOCKED)) {
      cb({ state: "partial", note: "地区不支持 (" + region + ")" });
      return;
    }
    cb({ state: "ok", note: region ? "地区 " + region : "" });
  });
}

function parseNetflixRedirectRegion(location) {
  var m = /netflix\.com\/([A-Za-z]{2})(?:-|[/?])/i.exec(String(location || ""));
  if (m) return normalizeRegion(m[1]);
  m = /\/([A-Za-z]{2})-[A-Za-z]{2}\/title/i.exec(String(location || ""));
  if (m) return normalizeRegion(m[1]);
  return "";
}

function checkNetflixTitles(cb) {
  var first = null;
  var second = null;
  var done = false;
  function decide() {
    if (!first || !second || done) return;
    done = true;
    if (first.error && second.error) { cb({ state: "fail", note: "请求失败" }); return; }
    if (first.status === 404 && second.status === 404) {
      cb({ state: "partial", note: "仅自制剧" });
      return;
    }
    if (first.status === 403 || second.status === 403) {
      cb({ state: "partial", note: "地区不支持" });
      return;
    }
    if (first.status === 200 || first.status === 301 || second.status === 200 || second.status === 301) {
      httpGet("https://www.netflix.com/title/80018499", 8, true, function (error3, response3, data3) {
        var region = "";
        if (!error3 && response3) {
          region = parseNetflixRedirectRegion(getHeader(response3, "Location"));
        }
        cb({ state: "ok", note: region ? "解锁区域 " + region : "" });
      });
      return;
    }
    cb(statusResult(first.status || second.status));
  }
  httpGet("https://www.netflix.com/title/81280792", 8, false, function (error, response, data) {
    first = { error: !!error, status: response ? response.status : 0 };
    decide();
  });
  httpGet("https://www.netflix.com/title/70143836", 8, false, function (error, response, data) {
    second = { error: !!error, status: response ? response.status : 0 };
    decide();
  });
}

function checkNetflix(svc, cb) {
  httpGet("https://api.fast.com/netflix/speedtest/v2?https=true&token=YXNkZmFzZGxmbnNkYWZoYXNkZmhrYWxm&urlCount=5", 8, false, function (error, response, data) {
    var status = response ? response.status : 0;
    var payload = null;
    var country = "";
    if (!error && status === 403) { cb({ state: "fail", note: "已被屏蔽" }); return; }
    if (!error && status >= 200 && status < 300) {
      try {
        payload = JSON.parse(data);
      } catch (e) {
        payload = null;
      }
      if (payload && payload.targets && payload.targets.length > 0 && payload.targets[0].location) {
        country = normalizeRegion(payload.targets[0].location.country || "");
        if (country) { cb({ state: "ok", note: "解锁区域 " + country }); return; }
      }
    }
    checkNetflixTitles(cb);
  });
}

// Disney+：FlClash 的完整做法是注册设备、换 token、再查会话地区，
// 需要 Disney 发给浏览器的公开令牌 + 3 次 POST；为避免把令牌写进
// 公开仓库，这里只读首页正文里的 countryCode / inSupportedLocation。
function checkDisney(svc, cb) {
  httpGet("https://www.disneyplus.com/", 8, false, function (error, response, data) {
    var status = response ? response.status : 0;
    var raw = firstMatch(data, /"countryCode"\s*:\s*"([^"]+)"/);
    var region = normalizeRegion(raw);
    var supported = firstMatch(data, /"inSupportedLocation"\s*:\s*(false|true)/);
    if (error) { cb({ state: "fail", note: "请求失败" }); return; }
    if (containsText(data, "disney+ is not available")) {
      cb({ state: "partial", note: "地区不支持" + (region ? " (" + region + ")" : "") });
      return;
    }
    if (supported === "false") {
      cb({ state: "partial", note: "地区不支持/未上线" + (region ? " (" + region + ")" : "") });
      return;
    }
    if (supported === "true") {
      cb({ state: "ok", note: region ? "地区 " + region : "" });
      return;
    }
    if (region) {
      cb({ state: "ok", note: "地区 " + region });
      return;
    }
    cb(statusResult(status));
  });
}

function checkPrime(svc, cb) {
  httpGet("https://www.primevideo.com", 8, false, function (error, response, data) {
    var raw = firstMatch(data, /"currentTerritory":"([^"]+)"/);
    var region = "";
    if (error) { cb({ state: "fail", note: "请求失败" }); return; }
    if (containsText(data, "isServiceRestricted")) {
      cb({ state: "partial", note: "地区不支持" });
      return;
    }
    if (raw) {
      region = normalizeRegion(raw);
      if (region) { cb({ state: "ok", note: "地区 " + region }); return; }
    }
    cb({ state: "fail", note: "无地区信息" });
  });
}

function checkSpotify(svc, cb) {
  httpGet("https://www.spotify.com/api/content/v1/country-selector?platform=web&format=json", 8, false, function (error, response, data) {
    var status = response ? response.status : 0;
    var region = normalizeRegion(firstMatch(data, /"countryCode"\s*:\s*"([^"]+)"/));
    if (error) { cb({ state: "fail", note: "请求失败" }); return; }
    if (status === 403 || status === 451) { cb({ state: "partial", note: "地区不支持" + (region ? " (" + region + ")" : "") }); return; }
    if (status < 200 || status >= 300) { cb(statusResult(status)); return; }
    if (containsText(data, "not available in your country")) {
      cb({ state: "partial", note: "地区不支持" + (region ? " (" + region + ")" : "") });
      return;
    }
    cb({ state: "ok", note: region ? "地区 " + region : "" });
  });
}

function checkTikTok(svc, cb) {
  httpGet("https://www.tiktok.com/", 8, false, function (error, response, data) {
    var status = response ? response.status : 0;
    var region = normalizeRegion(firstMatch(data, /"webapp\.app-context"\s*:\s*\{[^{}]*?"region"\s*:\s*"([^"]*)"/));
    if (error) { cb({ state: "fail", note: "请求失败" }); return; }
    if (status === 403 || status === 451) { cb({ state: "partial", note: "地区不支持" + (region ? " (" + region + ")" : "") }); return; }
    if (status < 200 || status >= 300) { cb({ state: "fail", note: "HTTP " + status }); return; }
    if (containsText(data, "access denied") || containsText(data, "not available in your region") || containsText(data, "tiktok is not available")) {
      cb({ state: "partial", note: "地区不支持" + (region ? " (" + region + ")" : "") });
      return;
    }
    cb({ state: "ok", note: region ? "地区 " + region : "" });
  });
}

function checkDiscord(svc, cb) {
  httpGet("https://discord.com/api/v9/auth/location-metadata", 8, false, function (error, response, data) {
    var status = response ? response.status : 0;
    var r;
    var region;
    if (error) { cb({ state: "fail", note: "请求失败" }); return; }
    r = statusResult(status);
    if (r.state !== "ok") { cb(r); return; }
    region = normalizeRegion(firstMatch(data, /"country_code"\s*:\s*"([^"]+)"/));
    cb({ state: "ok", note: region ? "地区 " + region : "" });
  });
}

function parseBilibiliCode(body) {
  return firstMatch(String(body || ""), /"code"\s*:\s*(-?\d+)/);
}

function checkBilibili(svc, cb) {
  var firstUrl = "https://api.bilibili.com/pgc/player/web/playurl?avid=82846771&qn=0&type=&otype=json&ep_id=307247&fourk=1&fnver=0&fnval=16&module=bangumi";
  var secondUrl = "https://api.bilibili.com/pgc/player/web/playurl?avid=18281381&cid=29892777&qn=0&type=&otype=json&ep_id=183799&fourk=1&fnver=0&fnval=16&module=bangumi";
  httpGet(firstUrl, 8, false, function (error, response, data) {
    var code = parseBilibiliCode(data);
    if (error) { cb({ state: "fail", note: "请求失败" }); return; }
    if (code === "0") { cb({ state: "ok", note: "地区 CN" }); return; }
    if (code === "-10403") {
      httpGet(secondUrl, 8, false, function (error2, response2, data2) {
        var code2 = parseBilibiliCode(data2);
        if (error2) { cb({ state: "fail", note: "请求失败" }); return; }
        if (code2 === "0") { cb({ state: "ok", note: "港澳台片源" }); return; }
        if (code2 === "-10403") { cb({ state: "partial", note: "地区不支持" }); return; }
        cb({ state: "fail", note: code2 ? "code " + code2 : "无返回码" });
      });
      return;
    }
    cb({ state: "fail", note: code ? "code " + code : "无返回码" });
  });
}

var CHECKERS = {
  google: checkReachable("https://www.google.com/generate_204"),
  github: checkReachable("https://github.com/"),
  youtube: checkYouTube,
  chatgpt: checkChatGpt,
  claude: checkClaude,
  gemini: checkGemini,
  netflix: checkNetflix,
  disney: checkDisney,
  prime: checkPrime,
  spotify: checkSpotify,
  tiktok: checkTikTok,
  discord: checkDiscord,
  bilibili: checkBilibili
};

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
    if (results[j].note) {
      lines.push(icon + " " + SERVICES[j].icon + " " + SERVICES[j].name + " " + results[j].ms + "ms · " + results[j].note);
    } else {
      lines.push(icon + " " + SERVICES[j].icon + " " + SERVICES[j].name + " " + results[j].ms + "ms");
    }
  }
  title = "服务状态 " + okCount + "/" + SERVICES.length + " 可用";
  if (okCount === SERVICES.length) style = "good";
  else if (okCount >= 9) style = "info";
  else if (okCount >= 5) style = "alert";
  else style = "error";
  $done({ title: title, content: lines.join("\n"), style: style });
}

function runService(idx) {
  var start = Date.now();
  var checker = CHECKERS[SERVICES[idx].kind];
  try {
    checker(SERVICES[idx], function (r) {
      results[idx] = { state: r.state || "fail", ms: Date.now() - start, note: r.note || "" };
      pending--;
      if (pending <= 0) finish();
    });
  } catch (e) {
    results[idx] = { state: "fail", ms: Date.now() - start, note: "脚本异常" };
    pending--;
    if (pending <= 0) finish();
  }
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
    runService(i);
  }
  checkIp();
  setTimeout(function () {
    if (!finished) finish();
  }, 25000);
} catch (e) {
  $done({ title: "服务状态", content: "脚本异常: " + e, style: "error" });
}
