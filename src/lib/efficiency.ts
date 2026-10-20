/**
 * Verimlilik Endeksi: Skor ve hız dengesi (0-100).
 *
 * Formül: kalite × hızBonusu
 *   - kalite    = totalScore (0-100) → doğrudan kullanılır
 *   - hızBonusu = 0.6 + 0.4 × hızFaktörü
 *       * hızFaktörü = TPS katkısı ve cevap süresi katkısının ortalaması:
 *         - tpsKatkısı   = min(avgTPS / 40, 1)          → 40+ tok/sn tam puan
 *         - süreKatkısı  = clamp(1 - süre/60sn, 0, 1)   → 0sn = 1.0, 60sn+ = 0
 *       * Böylece hem üretim hızı (TPS) hem de toplam cevap süresi
 *         (kullanıcının beklediği gerçek süre) değerlendirmeye dahil olur.
 *       * Yavaş modeller bile kalitelerinin %60'ını korur.
 *
 * Örnek: Skor 90, TPS 40, süre 5sn  → 90 × (0.6 + 0.4×(1.0+0.92)/2) ≈ 88.5
 *        Skor 90, TPS 10, süre 40sn → 90 × (0.6 + 0.4×(0.25+0.33)/2) ≈ 60.4
 */
export function computeEfficiencyIndex(
  totalScore: number,
  avgTPS: number,
  avgAnswerDurationMs?: number
): number {
  const quality = Math.max(0, Math.min(100, totalScore));

  // TPS katkısı: 40+ token/sn üretim hızı tam puan alır
  const tpsFactor = Math.min(avgTPS / 40, 1);

  // Cevap süresi katkısı: eski koşularda alan yoksa (undefined) nötr 1.0 kullan
  // → yalnız TPS bazlı eski formülle tutarlı kalır (geriye dönük uyumluluk).
  const durationFactor =
    avgAnswerDurationMs !== undefined && avgAnswerDurationMs > 0
      ? Math.max(0, Math.min(1, 1 - avgAnswerDurationMs / 60000))
      : 1;

  // İki hız sinyalinin ortalaması: hem akış hızı hem toplam bekleme süresi
  const speedFactor = (tpsFactor + durationFactor) / 2;
  const speedBonus = 0.6 + 0.4 * speedFactor;
  return Math.round(quality * speedBonus * 100) / 100;
}
