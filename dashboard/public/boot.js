// 在首帧之前执行：内置对象 polyfill + 主题预判。放在独立文件里而不是内联，
// 这样 CSP 可以禁止一切内联脚本（script-src 'self'）。
(function () {
  // ES2022 内置方法的 polyfill（上游为 Safari < 15.4 所加）：Base UI 用到
  // Object.hasOwn，TrendMonitor 用到 Array.prototype.at。
  try {
    if (typeof Object.hasOwn !== "function") {
      Object.defineProperty(Object, "hasOwn", {
        value: function (o, k) { return Object.prototype.hasOwnProperty.call(o, k); },
        configurable: true, writable: true,
      });
    }
    function at(n) {
      n = Math.trunc(n) || 0;
      if (n < 0) n += this.length;
      return n < 0 || n >= this.length ? undefined : this[n];
    }
    if (typeof Array.prototype.at !== "function") {
      Object.defineProperty(Array.prototype, "at", { value: at, configurable: true, writable: true });
    }
    if (typeof String.prototype.at !== "function") {
      Object.defineProperty(String.prototype, "at", { value: at, configurable: true, writable: true });
    }
  } catch (e) {}
  document.documentElement.classList.add("js");
  // 首帧前同步主题，避免深色模式下先闪一下浅色
  try {
    var t = localStorage.getItem("tokentracker-theme");
    var dark = t === "dark" || (t !== "light" && matchMedia("(prefers-color-scheme:dark)").matches);
    if (dark) document.documentElement.classList.add("dark");
  } catch (e) {}
})();
