import { lookup } from "node:dns";
import { request } from "node:https";
import { BlockList, isIP } from "node:net";

const restricted4 = new BlockList();
for (const [address, bits] of [
  ["0.0.0.0",8], ["10.0.0.0",8], ["100.64.0.0",10], ["127.0.0.0",8], ["169.254.0.0",16], ["172.16.0.0",12],
  ["192.0.0.0",24], ["192.0.2.0",24], ["192.88.99.0",24], ["192.168.0.0",16], ["198.18.0.0",15],
  ["198.51.100.0",24], ["203.0.113.0",24], ["224.0.0.0",3],
]) restricted4.addSubnet(address, bits, "ipv4");
const global6 = new BlockList();
global6.addSubnet("2000::", 3, "ipv6");
const restricted6 = new BlockList();
for (const [address, bits] of [["2001::",23], ["2001:db8::",32], ["2002::",16], ["3fff::",20]]) {
  restricted6.addSubnet(address, bits, "ipv6");
}

export function isPublicAddress(address) {
  const family = isIP(address);
  return family === 4 ? !restricted4.check(address, "ipv4")
    : family === 6 && global6.check(address, "ipv6") && !restricted6.check(address, "ipv6");
}

export function approvedPublicUrl(input, configuredHosts = process.env.CIVIC_RADAR_PUBLIC_HOSTS || "") {
  const url = new URL(input);
  const hosts = configuredHosts.toLowerCase().split(",").map(host => host.trim()).filter(Boolean);
  if (url.protocol !== "https:" || url.username || url.password || url.port || isIP(url.hostname) ||
      !url.hostname.includes(".") || url.hostname.endsWith(".") || !hosts.includes(url.hostname)) {
    throw new Error("该公告域名未获准由服务器读取。请联系管理员配置，或粘贴公告正文。");
  }
  return url;
}

function lookupPublic(host, options, callback) {
  lookup(host, { all: true, family: options.family, verbatim: true }, (error, addresses) => {
    if (error) return callback(error);
    if (!addresses.length || addresses.some(item => !isPublicAddress(item.address))) {
      return callback(new Error("目标域名没有可用的公开网络地址。"));
    }
    if (options.all) callback(null, addresses);
    else callback(null, addresses[0].address, addresses[0].family);
  });
}

// Bind the network socket to the validated DNS results. Do not follow redirects.
export function fetchPublic(input, { headers, signal, maxBytes = 4 * 1024 * 1024 } = {}) {
  const url = approvedPublicUrl(input);
  return new Promise((resolve, reject) => {
    const req = request(url, { headers, signal, lookup: lookupPublic, agent: false }, async res => {
      try {
        let size = 0;
        const chunks = [];
        for await (const chunk of res) {
          size += chunk.length;
          if (size > maxBytes) throw new Error("远端响应超过读取限制。");
          chunks.push(chunk);
        }
        const status = res.statusCode || 502;
        const payload = [204, 205, 304].includes(status) ? null : Buffer.concat(chunks);
        const responseHeaders = new Headers();
        for (const [name, value] of Object.entries(res.headers)) {
          if (typeof value === "string" && name !== "set-cookie") responseHeaders.set(name, value);
        }
        resolve(new Response(payload, { status, headers: responseHeaders }));
      } catch (error) {
        res.destroy();
        reject(error);
      }
    });
    req.on("error", reject);
    req.end();
  });
}
