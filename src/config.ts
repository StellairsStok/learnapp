// 中转平台配置。静态站没有后端,浏览器直接调用中转平台的 Anthropic 兼容接口。
// key 会随构建产物暴露在网页里——用户已知悉并接受(用有限额的中转 key)。
// 取值优先 Vite env(.env 里的 VITE_ 变量,已 gitignore),否则用下方兜底。
export const PROXY_URL =
  (import.meta.env.VITE_PROXY_URL as string) || "https://claude.proai.love";
export const PROXY_KEY =
  (import.meta.env.VITE_PROXY_KEY as string) ||
  "sk-JDEqsbumVknv4CsDStEaGEdJwlnlKlPZnPzKrA4GfkFstpVW";
export const MODEL = "claude-opus-4-8";
/** 高考日期(黑龙江),倒计时用 */
export const EXAM_DATE = "2027-06-07";
export const MAX_TOKENS = 2048;

/** 静态资源基路径(GitHub Pages 子路径下如 /learnapp/)。 */
export const ASSET_BASE = import.meta.env.BASE_URL; // 形如 "/learnapp/"
