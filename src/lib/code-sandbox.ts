import * as ts from "typescript";
import vm from "node:vm";
import { SandboxTestResult } from "../types/benchmark";

/**
 * ═══════════════════════════════════════════════════════════════════
 * SÜTUN 2 — CANLI KOD ÇALIŞTIRMA (Sandboxed Execution)
 * ═══════════════════════════════════════════════════════════════════
 *
 * Kodlama sorularında "Hakem LLM" kullanmak yerine modelden alınan
 * TypeScript fonksiyonu izole bir Node.js vm ortamında çalıştırılır ve
 * GİZLİ unit testlerden geçirilir:
 *   - Doğruluk testleri: temel + uç senaryolar (boş dizi, derin yuvalama)
 *   - Performans testi: 100.000 elemanlı dizide O(n) doğrulaması (timeout)
 *
 * Kodun syntax'ına veya açıklamasına değil, testleri geçip geçmediğine
 * (pass/fail) ve harcanan süreye puan verilir.
 */

/** Sandbox script çalışma sınırı: 5 saniye (senkron). */
const VM_TIMEOUT_MS = 5000;

/**
 * Model cevabından kod bloğunu çıkarır.
 * Markdown code fence'i varsa içeriğini alır, yoksa tüm metni kod kabul eder.
 */
export function extractCodeBlock(answer: string): string {
  const fenceMatch = answer.match(/```(?:typescript|ts|javascript|js)?\s*\n([\s\S]*?)```/i);
  if (fenceMatch && fenceMatch[1].trim()) {
    return fenceMatch[1].trim();
  }
  // Fence yoksa: think etiketleri temizlenmiş metni kod olarak dene
  return answer.trim();
}

/**
 * TypeScript kodunu hızlıca JavaScript'e dönüştürür.
 * Tip kontrolü yapılmaz (transpileModule) — amaç çalıştırılabilirlik.
 */
export function transpileTypeScript(code: string): string {
  const result = ts.transpileModule(code, {
    compilerOptions: {
      target: ts.ScriptTarget.ES2020,
      module: ts.ModuleKind.None,
      strict: false,
    },
  });
  return result.outputText;
}

/**
 * Derin eşitlik kontrolü (sandbox içinde kullanılır).
 * Basit JSON karşılaştırması — number[] ve nested diziler için yeterli.
 */
const DEEP_EQUAL_HELPER = `
function __deepEqual(a, b) {
  if (a === b) return true;
  if (typeof a !== typeof b) return false;
  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) {
      if (!__deepEqual(a[i], b[i])) return false;
    }
    return true;
  }
  return false;
}
`;

/**
 * Test harness şablonu: __test helper'ı sonuçları __results'a yazar.
 * Sandbox context'ine HİÇBİR Node.js global'i (require, process, fetch,
 * console) verilmez — sadece saf matematik yapılabilir.
 */
function buildHarness(userJsCode: string, testCode: string): string {
  return `
"use strict";
${DEEP_EQUAL_HELPER}
const __results = [];
function __test(name, fn) {
  const start = __DateNow();
  try {
    fn();
    __results.push({ name: name, passed: true, durationMs: __DateNow() - start });
  } catch (e) {
    __results.push({
      name: name,
      passed: false,
      detail: String(e && e.message ? e.message : e).slice(0, 200),
      durationMs: __DateNow() - start,
    });
  }
}
${userJsCode}
${testCode}
__results;
`;
}

/**
 * Kodu sandbox'ta çalıştırır ve test sonuçlarını döndürür.
 * Timeout aşılırsa vm hata fırlatır — bu, performans testinin
 * "başarısız" olarak kaydedilmesi anlamına gelir.
 */
function runInSandbox(harnessCode: string): Array<{
  name: string;
  passed: boolean;
  detail?: string;
  durationMs: number;
}> {
  const sandbox: Record<string, unknown> = {
    // Yalnızca zararsız zaman ölçümü — require/process/fetch YOK
    __DateNow: () => Date.now(),
    Math,
    JSON,
    Array,
    Object,
    String,
    Number,
    Boolean,
    Set,
    Map,
    isNaN,
    parseInt,
    parseFloat,
  };
  const context = vm.createContext(sandbox, {
    name: "benchmark-code-sandbox",
  });
  const script = new vm.Script(harnessCode, { filename: "submission.js" });
  const result = script.runInContext(context, { timeout: VM_TIMEOUT_MS });
  return result as Array<{
    name: string;
    passed: boolean;
    detail?: string;
    durationMs: number;
  }>;
}

/**
 * Q9 — distinctOrderPreserving için gizli unit testler.
 * Doğruluk testleri ve performans testi AYRI sandbox koşularında
 * çalıştırılır: O(n²) bir algoritma performans testinde timeout'a
 * takıldığında doğruluk sonuçları kaybolmasın.
 */
export function testDistinctOrderPreserving(modelAnswer: string): SandboxTestResult[] {
  const userCode = transpileTypeScript(extractCodeBlock(modelAnswer));
  const results: SandboxTestResult[] = [];

  // ── Koşum 1: Doğruluk testleri (küçük girdiler) ──
  const accuracyTests = `
__test("temel-dogruluk", function() {
  if (typeof distinctOrderPreserving !== "function") throw new Error("Fonksiyon 'distinctOrderPreserving' tanımlı değil");
  const r = distinctOrderPreserving([1, 2, 2, 3, 1]);
  if (!__deepEqual(r, [1, 2, 3])) throw new Error("Beklenen [1,2,3], alınan: " + JSON.stringify(r));
});
__test("bos-dizi", function() {
  const r = distinctOrderPreserving([]);
  if (!__deepEqual(r, [])) throw new Error("Boş dizi bekleniyordu, alınan: " + JSON.stringify(r));
});
__test("tek-eleman", function() {
  const r = distinctOrderPreserving([7]);
  if (!__deepEqual(r, [7])) throw new Error("Beklenen [7], alınan: " + JSON.stringify(r));
});
__test("hepsi-ayni", function() {
  const r = distinctOrderPreserving([5, 5, 5, 5]);
  if (!__deepEqual(r, [5])) throw new Error("Beklenen [5], alınan: " + JSON.stringify(r));
});
__test("negatif-ve-sifir", function() {
  const r = distinctOrderPreserving([0, -1, 0, -1, 2]);
  if (!__deepEqual(r, [0, -1, 2])) throw new Error("Beklenen [0,-1,2], alınan: " + JSON.stringify(r));
});
__test("rastgele-50-eleman", function() {
  const input = [];
  const seen = {};
  for (let i = 0; i < 50; i++) input.push(Math.floor(Math.random() * 20));
  const expected = [];
  const expSet = new Set();
  for (const v of input) { if (!expSet.has(v)) { expSet.add(v); expected.push(v); } }
  const r = distinctOrderPreserving(input);
  if (!__deepEqual(r, expected)) throw new Error("Sıra korunmalı; beklenen: " + JSON.stringify(expected) + ", alınan: " + JSON.stringify(r));
});
`;
  try {
    const accuracyResults = runInSandbox(buildHarness(userCode, accuracyTests));
    results.push(...accuracyResults);
  } catch (e) {
    results.push({
      name: "dogruluk-testleri",
      passed: false,
      detail: `Sandbox hatası (syntax/çalışma zamanı): ${e instanceof Error ? e.message.slice(0, 200) : String(e)}`,
      durationMs: 0,
    });
  }

  // ── Koşum 2: Performans testi (1.000.000 eleman, O(n) doğrulaması) ──
  // 1M eleman × 50.000 tekil değer: O(n) Set tabanlı çözüm ~100ms'de biter;
  // O(n²) includes tabanlı çözüm ~25 milyar karşılaştırma yapar → timeout'a düşer.
  const perfTest = `
__test("performans-1M-O(n)", function() {
  const input = [];
  for (let i = 0; i < 1000000; i++) input.push(i % 50000);
  const r = distinctOrderPreserving(input);
  if (!Array.isArray(r) || r.length !== 50000) throw new Error("1M girdiden 50000 tekil değer bekleniyordu, alınan uzunluk: " + (r ? r.length : "N/A"));
  if (r[0] !== 0 || r[1] !== 1) throw new Error("Sıra korunmalı: ilk elemanlar [0,1] olmalı");
});
`;
  try {
    const perfResults = runInSandbox(buildHarness(userCode, perfTest));
    results.push(...perfResults);
  } catch (e) {
    const isTimeout = e instanceof Error && /timed out|timeout/i.test(e.message);
    results.push({
      name: "performans-1M-O(n)",
      passed: false,
      detail: isTimeout
        ? `Timeout: 1.000.000 elemanlı dizi ${VM_TIMEOUT_MS / 1000} sn içinde bitmedi — algoritma muhtemelen O(n²)`
        : `Sandbox hatası: ${e instanceof Error ? e.message.slice(0, 200) : String(e)}`,
      durationMs: VM_TIMEOUT_MS,
    });
  }

  return results;
}

/**
 * Q10 — flattenAndSortEvens için gizli unit testler.
 * Derin yuvalama, boş diziler ve negatif çiftler dahil uç senaryolar.
 */
export function testFlattenAndSortEvens(modelAnswer: string): SandboxTestResult[] {
  const userCode = transpileTypeScript(extractCodeBlock(modelAnswer));
  const results: SandboxTestResult[] = [];

  const accuracyTests = `
__test("temel-dogruluk", function() {
  if (typeof flattenAndSortEvens !== "function") throw new Error("Fonksiyon 'flattenAndSortEvens' tanımlı değil");
  const r = flattenAndSortEvens([1, [4, 2], [8, [6, 3]]]);
  if (!__deepEqual(r, [8, 6, 4, 2])) throw new Error("Beklenen [8,6,4,2], alınan: " + JSON.stringify(r));
});
__test("derin-yuvalama", function() {
  const r = flattenAndSortEvens([[], [1, [2, [3, [4]]]]]);
  if (!__deepEqual(r, [4, 2])) throw new Error("Derin yuvalamada beklenen [4,2], alınan: " + JSON.stringify(r));
});
__test("bos-dizi", function() {
  const r = flattenAndSortEvens([]);
  if (!__deepEqual(r, [])) throw new Error("Boş dizi bekleniyordu, alınan: " + JSON.stringify(r));
});
__test("hepsi-bos-ic-ice", function() {
  const r = flattenAndSortEvens([[], [[]], [[[]]]]);
  if (!__deepEqual(r, [])) throw new Error("İç içe boş dizilerden [] bekleniyordu, alınan: " + JSON.stringify(r));
});
__test("negatif-ciftler", function() {
  const r = flattenAndSortEvens([-2, [-4, [6]], 3]);
  if (!__deepEqual(r, [6, -2, -4])) throw new Error("Beklenen [6,-2,-4], alınan: " + JSON.stringify(r));
});
__test("sifir-cifttir", function() {
  const r = flattenAndSortEvens([0, [1, [0, 2]]]);
  if (!__deepEqual(r, [2, 0, 0])) throw new Error("0 çifttir: beklenen [2,0,0], alınan: " + JSON.stringify(r));
});
__test("cok-katmanli-karisik", function() {
  const r = flattenAndSortEvens([10, [9, [8, [7, [6, [5, [4]]]]]]]);
  if (!__deepEqual(r, [10, 8, 6, 4])) throw new Error("7 katman yuvalamada beklenen [10,8,6,4], alınan: " + JSON.stringify(r));
});
`;
  try {
    const accuracyResults = runInSandbox(buildHarness(userCode, accuracyTests));
    results.push(...accuracyResults);
  } catch (e) {
    results.push({
      name: "dogruluk-testleri",
      passed: false,
      detail: `Sandbox hatası (syntax/çalışma zamanı): ${e instanceof Error ? e.message.slice(0, 200) : String(e)}`,
      durationMs: 0,
    });
  }

  // ── Performans: 20.000 elemanlı derin yuvalama (recursion depth stresi) ──
  const perfTest = `
__test("performans-derin-recursion", function() {
  // 2000 katman derinlikte iç içe dizi + toplam 20.000 eleman
  let deep = [];
  let cur = deep;
  for (let i = 0; i < 2000; i++) {
    const next = [];
    cur.push(i * 2, next);
    cur = next;
  }
  cur.push(1999 * 2 + 2);
  const r = flattenAndSortEvens(deep);
  if (!Array.isArray(r) || r.length !== 2001) throw new Error("2001 çift sayı bekleniyordu, alınan: " + (r ? r.length : "N/A"));
});
`;
  try {
    const perfResults = runInSandbox(buildHarness(userCode, perfTest));
    results.push(...perfResults);
  } catch (e) {
    const isTimeout = e instanceof Error && /timed out|timeout/i.test(e.message);
    results.push({
      name: "performans-derin-recursion",
      passed: false,
      detail: isTimeout
        ? `Timeout: derin recursion ${VM_TIMEOUT_MS / 1000} sn içinde bitmedi`
        : `Sandbox hatası (stack overflow olabilir): ${e instanceof Error ? e.message.slice(0, 200) : String(e)}`,
      durationMs: VM_TIMEOUT_MS,
    });
  }

  return results;
}

/**
 * Kod sorusunun sandbox testlerini koşar ve 0-100 arası puan döndürür.
 * Puan = geçen test / toplam test × 100.
 */
export function evaluateCodeInSandbox(
  functionName: string,
  modelAnswer: string
): { score: number; tests: SandboxTestResult[] } {
  let tests: SandboxTestResult[];
  if (functionName === "distinctOrderPreserving") {
    tests = testDistinctOrderPreserving(modelAnswer);
  } else if (functionName === "flattenAndSortEvens") {
    tests = testFlattenAndSortEvens(modelAnswer);
  } else {
    tests = [
      { name: "bilinmeyen-fonksiyon", passed: false, detail: `Bilinmeyen fonksiyon: ${functionName}`, durationMs: 0 },
    ];
  }

  const passed = tests.filter((t) => t.passed).length;
  const score = tests.length > 0 ? Math.round((passed / tests.length) * 100) : 0;
  return { score, tests };
}
