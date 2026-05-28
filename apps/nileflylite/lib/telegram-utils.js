export function getInitDataUnsafe(initData) {
  if (!initData) return {};
  const params = new URLSearchParams(initData);
  const data = {};
  for (const [key, value] of params.entries()) {
    try {
      data[key] = JSON.parse(value);
    } catch {
      data[key] = value;
    }
  }
  return data;
}

export function extractTgWebAppData(url) {
  const parsedUrl = new URL(url);
  const params = new URLSearchParams(parsedUrl.hash.replace(/^#/, ""));
  const initData = params.get("tgWebAppData");
  return {
    platform: params.get("tgWebAppPlatform"),
    version: params.get("tgWebAppVersion"),
    initData,
    initDataUnsafe: getInitDataUnsafe(initData),
  };
}
