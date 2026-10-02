import { mdiBeer, mdiCoffee, mdiHandHeart } from "@mdi/js";

/** Link GitHub + donate dung chung cho Cai dat -> Ve ung dung va nut (i) canh
 * so phien ban tren dau trang (v0.5.66). */
export const GITHUB_URL = "https://github.com/thaihoang987/My-addon-Scheduler";

export const DONATE_LINKS = [
  { href: "https://buymeacoffee.com/leon_bell", icon: mdiBeer, modifier: "beer", vi: "Mời mình 1 ly bia", en: "Buy me a beer" },
  { href: "https://ko-fi.com/leonbell", icon: mdiCoffee, modifier: "kofi", vi: "Ủng hộ qua Ko-fi", en: "Support on Ko-fi" },
  { href: "https://paypal.me/leonbell95", icon: mdiHandHeart, modifier: "paypal", vi: "Ủng hộ qua PayPal", en: "Donate with PayPal" },
];
