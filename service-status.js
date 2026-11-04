// 服务状态面板脚本 · Surge generic script
// 检测当前出站节点对 9 个服务的连通性，结果显示在 [Panel] 里。
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
  { name: "Prime Video", url: "https://www.primevideo.com/", kind: "generic" }
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
  else if (okCount >= 6) style = "info";
  else if (okCount >= 3) style = "alert";
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
