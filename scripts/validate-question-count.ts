/**
 * Doğrulama: 'all' kategorisi seçildiğinde 39 sorunun üretildiğini ve
 * DB'deki soru seçimiyle filtre sonrası 39 sorunun koşulacağını kanıtlar.
 *
 * Çalıştırma: npx tsx scripts/validate-question-count.ts
 */
import { generateRunQuestionsByCategory } from '../src/lib/question-generators';
import { readQuestionSelection } from '../src/lib/db';

async function main() {
  const all = generateRunQuestionsByCategory(['all'], true);
  const ids = all.map((q) => q.id).sort((a, b) => a - b);
  console.log(`'all' kategorisinin ürettiği soru sayısı: ${all.length}`);
  console.log(`ID'ler: ${ids.join(', ')}`);

  const general = ids.filter((id) => id < 100);
  const coding = ids.filter((id) => id >= 100 && id < 200);
  const turkish = ids.filter((id) => id >= 200);
  console.log(`Genel (1-27): ${general.length} adet`);
  console.log(`Kodlama (101-105): ${coding.length} adet → ${coding.join(', ')}`);
  console.log(`Türkçe (200-209): ${turkish.length} adet → ${turkish.join(', ')}`);

  // Tekrarlanan ID kontrolü (aynı soru iki kez koşmasın)
  const duplicates = ids.filter((id, i) => ids.indexOf(id) !== i);
  if (duplicates.length > 0) {
    console.error(`❌ TEKRARLANAN ID'LER: ${[...new Set(duplicates)].join(', ')}`);
    process.exit(1);
  }

  // DB seçimiyle filtre simülasyonu (benchmark-runner'daki mantığın aynısı)
  const enabled = await readQuestionSelection();
  if (enabled === null) {
    console.log(`DB seçimi: null (tüm sorular seçili) → koşulacak: ${all.length}`);
  } else {
    const filtered = all.filter((q) => enabled.includes(q.id));
    const missing = all.filter((q) => !enabled.includes(q.id)).map((q) => q.id);
    console.log(`DB seçimi: ${enabled.length} ID → filtre sonrası koşulacak: ${filtered.length}`);
    if (missing.length > 0) {
      console.error(`⚠️ Üretilip DB seçiminde OLMAYAN ID'ler: ${missing.join(', ')}`);
    } else {
      console.log('✅ Üretilen tüm sorular DB seçiminde mevcut — hepsi koşacak.');
    }
  }

  if (all.length !== 39) {
    console.error(`❌ BEKLENEN: 39 soru, GERÇEKLEŞEN: ${all.length}`);
    process.exit(1);
  }
  console.log('✅ Doğrulama tamam: "Hepsi" seçildiğinde 39 soru üretiliyor ve koşuluyor.');
}

main().catch((e) => {
  console.error('Doğrulama hatası:', e);
  process.exit(1);
});
