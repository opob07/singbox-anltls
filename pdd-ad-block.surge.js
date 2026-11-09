// 拼多多去广告 · Surge 版
// 改写自 atopsecret/SurgeScripts pdd-ad-block.egern.js（Egern 原生 API，eg-native-20261105-r1）
// Egern 用 export default async function(ctx) + ctx.storage + ctx.response.text()；
// Surge 用 $request / $response / $done，响应正文由 requires-body=true 提供为 $response.body。
// Egern 的诊断持久化状态与 widget 在 Surge 没有对应物，已略去，只保留页面净化本身。
// 净化逻辑与原版一致：只处理 api.pinduoduo.com / api.yangkeduo.com（或裸 IP + 正确 Host），
// 命中 homepage / personal / integration / order-list / order / search 时删广告字段；
// 非 2xx、非 JSON、服务端错误或无可改字段时原样放行。

const VERSION = "surge-20261109-r1";

const KEEP_TABS = ["index.html", "chat_list.html", "personal.html"];

const API_HOSTS = ["api.pinduoduo.com", "api.yangkeduo.com"];

function record(value) {
    return value !== null && typeof value === "object" && !Array.isArray(value);
}

function header(headers, name) {
    try {
        if (headers && typeof headers.get === "function") return String(headers.get(name) || "");
        if (headers) {
            const key = Object.keys(headers).find(value => value.toLowerCase() === name.toLowerCase());
            return key ? String(headers[key] || "") : "";
        }
    } catch (_) { /* 不根据读取失败的 Host 猜测请求归属。 */ }
    return "";
}

function bareIP(hostname) {
    if (/^\[[0-9a-f:]+\]$/i.test(hostname)) return true;
    return /^(?:\d{1,3}\.){3}\d{1,3}$/.test(hostname) && hostname.split(".").every(part => Number(part) <= 255);
}

function owned(request, url) {
    if (!["http:", "https:"].includes(url.protocol) || url.username || url.password) return false;
    if (API_HOSTS.includes(url.hostname)) return true;
    if (!bareIP(url.hostname)) return false;
    // 裸 IP 直连只接受已知 API 的精确 Host；域名子串和 UA 均不能替代它。
    const match = /^(api\.(?:pinduoduo|yangkeduo)\.com)(?::([0-9]{1,5}))?$/.exec(header(request.headers, "host").trim().toLowerCase());
    return Boolean(match && (!match[2] || Number(match[2]) > 0 && Number(match[2]) <= 65535));
}

function apiPath(pathname) {
    const known = new Map([
        ["/api/alexa/homepage/hub", "homepage"],
        ["/api/philo/personal/hub", "personal"],
        ["/api/oak/integration/render", "integration"],
        ["/api/aristotle/order_list_v4", "order-list"],
        ["/search", "search"]
    ]);
    return known.get(pathname) || (pathname.startsWith("/order/") ? "order" : "");
}

function delPath(root, path) {
    const keys = path.split(".");
    let node = root;
    for (const key of keys.slice(0, -1)) {
        if (!record(node)) return;
        node = node[key];
    }
    if (record(node)) delete node[keys[keys.length - 1]];
}

function filterTabs(tabs) {
    if (!Array.isArray(tabs) || !tabs.every(item => record(item) && typeof item.link === "string")) return { tabs, removed: 0 };
    // 只有识别到首页、聊天、个人三个核心入口，才使用原来源的导航白名单。
    // 缺少核心入口、对象类型变化或新协议时整份导航原样保留，避免清空底栏。
    if (!KEEP_TABS.every(link => tabs.some(item => item.link === link))) return { tabs, removed: 0 };
    const kept = tabs.filter(item => KEEP_TABS.includes(item.link));
    return { tabs: kept, removed: tabs.length - kept.length };
}

function failed(data) {
    return data.success === false || data.is_success === false || data.error_code !== undefined && ![0, "0", null, ""].includes(data.error_code);
}

function clean(data, api) {
    let removed = 0;
    if (api === "homepage" && record(data.result)) {
        const root = data.result;
        for (const key of ["bottom_tabs", "buffer_bottom_tabs"]) {
            const filtered = filterTabs(root[key]);
            if (filtered.removed) { root[key] = filtered.tabs; removed += filtered.removed; }
        }
        if (Array.isArray(root.all_top_opts)) {
            for (const option of root.all_top_opts) {
                if (!record(option)) continue;
                for (const key of ["selected_image", "image", "height", "width"]) delete option[key];
            }
        }
        delPath(root, "dy_module.irregular_banner_dy");
        delete root.icon_set;
        delete root.search_bar_hot_query;
    } else if (api === "personal") {
        delete data.monthly_card_entrance;
        delete data.personal_center_style_v2_vo;
        delPath(data, "icon_set.icons");
        delPath(data, "icon_set.top_personal_icons");
    } else if (api === "integration") {
        delete data.bottom_section_list;
        delPath(data, "ui.bottom_section");
        delPath(data, "ui.live_section.float_info");
    } else if (api === "order") {
        delete data.marketing_banner_vo;
        delPath(data, "shipping.banner_above_recommend");
    } else if (api === "order-list" && Array.isArray(data.orders)) {
        for (const order of data.orders) {
            if (!record(order) || !Array.isArray(order.order_buttons)) continue;
            for (const button of order.order_buttons) if (record(button)) delete button.order_growth_tip;
        }
    } else if (api === "search") delete data.expansion;
    return removed;
}

// ---- Surge 入口：$request / $response / $done ----
(function () {
    let api;
    try {
        const url = new URL($request.url);
        if (!owned($request, url)) { $done({}); return; }
        api = apiPath(url.pathname);
        if (!api) { $done({}); return; }
    } catch (_) { $done({}); return; }

    if ($response.status < 200 || $response.status >= 300) { $done({}); return; }

    const body = $response.body;
    if (!body) { $done({}); return; }

    let output = body;
    try {
        const data = JSON.parse(body);
        if (!record(data)) throw new Error("unknown-structure");
        if (!failed(data)) {
            const before = JSON.stringify(data);
            clean(data, api);
            const after = JSON.stringify(data);
            if (after !== before) output = after;
        }
    } catch (_) { /* 无效 JSON 或未知结构，保留原文。 */ }

    if (output !== body) $done({ body: output });
    else $done({});
})();
