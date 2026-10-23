/**
 * Türkçe 10 Soruluk Benchmark Seti
 * 10 farklı alt kategori, dinamik şablonlar, deterministik etiket kontrolü + Judge hibrit puanlama
 */

import { BenchmarkQuestion, TurkishQuestionType } from "../types/benchmark";

/** Türkçe soru alt kategorileri */
export const TURKISH_SUBCATEGORIES = [
  'ekim',      // Ek yanlışı düzeltme
  'deyim',     // Deyim anlamı
  'ozet',      // Kurallı özet
  'dilbilgisi', // Dilbilgisi / cümle yapısı
  'anlam',     // Anlam ayrımı / eş anlamlılar
  'yazim',     // Yazım kuralları
  'cumle',     // Cümle yapısı / sıralama
  'sozcuk',    // Sözcük türetme / kök-ek
  'paragraf',  // Paragraf tutarlılığı
  'edebi',     // Edebi metin analizi
] as const;

/** 10 Türkçe soru şablonu */
export const TURKISH_QUESTION_TEMPLATES: TurkishQuestionType[] = [
  {
    id: 'turkish-ekim-1',
    category: 'ekim',
    template: `Aşağıdaki cümlede **ek yanlışını** bulun ve düzeltin. Sadece düzeltilmiş cümleyi verin.

Cümle: "{sentence}"

Kural: {rule}

Cevap formatı: DÜZELTME: [düzeltilmiş cümle]`,
    expectedPattern: 'DÜZELTME:',
    keywords: ['ek', 'yanlış', 'düzelt'],
  },
  {
    id: 'turkish-ekim-2',
    category: 'ekim',
    template: `Aşağıdaki kelimenin **doğru ekli halini** yazın.

Kelime: "{word}"
Ek: {suffix}
Kural: {rule}

Cevap formatı: DÜZELTME: [doğru kelime]`,
    expectedPattern: 'DÜZELTME:',
    keywords: ['ek', 'yanlış', 'düzelt'],
  },
  {
    id: 'turkish-deyim-1',
    category: 'deyim',
    template: `Aşağıdaki deyimin **anlamını** açıklayın ve bir cümle içinde kullanın.

Deyim: "{idiom}"

Cevap formatı: ANLAM: [anlamı] | ÖRNEK: [örnek cümle]`,
    expectedPattern: 'ANLAM:',
    keywords: ['deyim', 'anlam', 'örnek'],
  },
  {
    id: 'turkish-deyim-2',
    category: 'deyim',
    template: `Aşağıdaki durumu ifade eden **deyimi** yazın.

Durum: "{situation}"

Cevap formatı: DEYİM: [deyim] | ANLAM: [kısa anlam]`,
    expectedPattern: 'DEYİM:',
    keywords: ['deyim', 'anlam'],
  },
  {
    id: 'turkish-ozet-1',
    category: 'ozet',
    template: `Aşağıdaki metni **maksimum {maxWords} kelimeyle** özetleyin. Ana fikri koruyun, detayları atın.

Metin: "{text}"

Cevap formatı: ÖZET: [özet metin]`,
    expectedPattern: 'ÖZET:',
    keywords: ['özet', 'ana fikir', 'kelime'],
  },
  {
    id: 'turkish-ozet-2',
    category: 'ozet',
    template: `Aşağıdaki metnin **başlığını** (maksimum 5 kelime) ve **tek cümlelik özetini** yazın.

Metin: "{text}"

Cevap formatı: BAŞLIK: [başlık] | ÖZET: [tek cümlelik özet]`,
    expectedPattern: 'BAŞLIK:|ÖZET:',
    keywords: ['başlık', 'özet', 'cümle'],
  },
  {
    id: 'turkish-dilbilgisi-1',
    category: 'dilbilgisi',
    template: `Aşağıdaki cümlede **dilbilgisi hatasını** bulun ve düzeltin.

Cümle: "{sentence}"

Cevap formatı: DÜZELTME: [düzeltilmiş cümle] | HATA: [hata türü]`,
    expectedPattern: 'DÜZELTME:|HATA:',
    keywords: ['dilbilgisi', 'hata', 'düzelt'],
  },
  {
    id: 'turkish-anlam-1',
    category: 'anlam',
    template: `Aşağıdaki iki kelimenin **anlam farkını** açıklayın ve her biri için birer örnek cümle yazın.

Kelimeler: "{word1}" - "{word2}"

Cevap formatı: FARK: [anlam farkı] | ÖRNEK1: [cümle] | ÖRNEK2: [cümle]`,
    expectedPattern: 'FARK:|ÖRNEK1:|ÖRNEK2:',
    keywords: ['anlam', 'fark', 'eş anlamlı', 'örnek'],
  },
  {
    id: 'turkish-yazim-1',
    category: 'yazim',
    template: `Aşağıdaki cümlede **yazım/ımla hatalarını** bulun ve düzeltin.

Cümle: "{sentence}"

Cevap formatı: DÜZELTME: [düzeltilmiş cümle] | HATALAR: [hatalı kelimeler listesi]`,
    expectedPattern: 'DÜZELTME:|HATALAR:',
    keywords: ['yazım', 'ımla', 'hata', 'düzelt'],
  },
  {
    id: 'turkish-cumle-1',
    category: 'cumle',
    template: `Aşağıdaki kelimelerden **anlamlı ve dilbilgisi kurallarına uygun bir cümle** kurun.

Kelimeler: {words}

Cevap formatı: CÜMLE: [oluşturulan cümle]`,
    expectedPattern: 'CÜMLE:',
    keywords: ['cümle', 'kur', 'kelimeler'],
  },
  {
    id: 'turkish-sozcuk-1',
    category: 'sozcuk',
    template: `Aşağıdaki kök kelimeden, verilen ekleri kullanarak **anlamlı türetilmiş kelimeler** yazın (en az 3).

Kök: "{root}"
Ekler: {suffixes}

Cevap formatı: TÜRETLER: [kelime1, kelime2, kelime3, ...]`,
    expectedPattern: 'TÜRETLER:',
    keywords: ['kök', 'ek', 'türet', 'kelime'],
  },
];

/** Dinamik parametre havuzları */
const DYNAMIC_PARAMS = {
  // Ekim yanlışları
  ekimSentences: [
    { sentence: "Kitabı masanın üzerin**e** koydum.", rule: "İsim tamlamasında '-e' eki yanlış, '-in/e' olmalı", correct: "Kitabı masanın üzerine koydum." },
    { sentence: "Arkadaş**ım**la sinemaya gittik.", rule: "1. şahıs çoğul ekinde 'ım' değil 'ımız' kullanılır", correct: "Arkadaşlarımızla sinemaya gittik." },
    { sentence: "Ev**e** gidiyorum.", rule: "Yön belirtme ekinde '-e' değil '-a' harmonik olmalı", correct: "Eve gidiyorum." },
    { sentence: "Çocuklar bahçede oynuyor**lar**.", rule: "3. şahıs çoğul ekinde 'lar' zaten var, 'lar' tekrarı yanlış", correct: "Çocuklar bahçede oynuyor." },
    { sentence: "Bu kitap ben**im**ki.", rule: "Belirtme halinde 'benimki' değil 'benim' kullanılır", correct: "Bu kitap benim." },
  ],
  ekimWords: [
    { word: "ev", suffix: "-de", rule: "Küçük ünlü uyumu: ev + de = evde", correct: "evde" },
    { word: "kitap", suffix: "-lık", rule: "Sertleşme: kitap + lık = kitaplık", correct: "kitaplık" },
    { word: "göz", suffix: "-lük", rule: "Küçük ünlü uyumu: göz + lük = gözlük", correct: "gözlük" },
    { word: "el", suffix: "-de", rule: "Küçük ünlü uyumu: el + de = elde", correct: "elde" },
    { word: "su", suffix: "-lu", rule: "Ünsüz yumuşama: su + lu = sulu", correct: "sulu" },
  ],
  // Deyimler
  idioms: [
    { idiom: "Ateş ateşe düşürülmez", meaning: "Kötülük kötülükle gidermez, sorunlar barışçıl yollarla çözülmelidir", situation: "Kavga etmek yerine uzlaşıp çözmek" },
    { idiom: "Damlaya damlaya göl olur", meaning: "Küçük birikimler büyük sonuçlar doğurur", situation: "Küçük tasarrufların birikmesi" },
    { idiom: "El elden üstündür", meaning: "Verenin eli alanın elinden üstündür, yardımcı seven üstündür", situation: "Yardım etmenin değerli olması" },
    { idiom: "Gözden çıkarılan gönülden de çıkar", meaning: "Görülmeyen/sevilmeyen kişi unutulur", situation: "Uzun süre görüşmeyen arkadaş" },
    { idiom: "İyi baştan başla", meaning: "İşin başlangıcı sağlam olursa sonu da iyidir", situation: "Yeni proje başlarken dikkatli olmak" },
  ],
  // Özet metinler
  summaryTexts: [
    { text: "Yapay zeka, makinelerin insan zekasını taklit ederek öğrenme, problem çözme ve karar verme yeteneği kazanmasını sağlayan bilgisayar bilimi dalıdır. Makine öğrenmesi, derin öğrenme ve doğal dil işleme gibi alt dalları bulunur. Günümüzde sağlık, finans, ulaşım ve eğitim gibi birçok alanda yaygın olarak kullanılmaktadır. Ancak etik endişeler, işsizlik riski ve veri gizliliği gibi sorunlar da beraberinde getirmektedir.", maxWords: 30, summary: "Yapay zeka, makinelerin insan zekasını taklit ederek problem çözmesini sağlayan bir alandır; sağlık ve finans gibi alanlarda kullanılırken etik ve gizlilik sorunları da yaratmaktadır." },
    { text: "Türkiye'nin dört mevsim yaşayan nadir ülkelerden biri olması, tarımsal çeşitliliğe ve turizm potansiyeline sahip olmasını sağlamıştır. Coğrafi konumu sayesinde Avrupa ve Asya kıtaları arasında köprü görevi görmektedir. 81 ili ve 7 coğrafi bölgeni ile zengin kültürel mirasa ev sahipliği yapmaktadır.", maxWords: 25, summary: "Türkiye dört mevsim, tarımsal çeşitlilik ve turizm potansiyeli ile Avrupa-Asya köprüsü konumundadır." },
    { text: "İklik değişikliği, sera gazı emisyonları sonucu küresel ısınmaya yol açarak doğa afetlerini artırmaktadır. Buzul erimesi, deniz seviyesi yükselmesi ve aşırı hava olayları canlı yaşamı tehdit etmektedir. Uluslararası anlaşmalar (Paris Anlaşması vb.) bu süreci yavaşlatmayı hedefler.", maxWords: 30, summary: "İklim değişikliği sera gazlarıyla küresel ısınmaya yol açar, doğa afetlerini artırır; uluslararası anlaşmalar bu süreci yavaşlatmayı hedefler." },
  ],
  // Dilbilgisi hataları
  grammarErrors: [
    { sentence: "Ali okula gitmedi, çünkü hasta.", error: "Bağlaç 'çünkü' cümle başında olamaz, 'çünkü' yerine 'zira' veya cümle sırası değiştirilmeli", correct: "Ali hasta olduğu için okula gitmedi." },
    { sentence: "Ben kitap okuyorum ve Ahmet de.", error: "Eşitsizlik: 'de' bağlacı yanlış, 'de' yerine 'de' (ek) veya cümle tekrarlanmalı", correct: "Ben kitap okuyorum, Ahmet de okuyor." },
    { sentence: "Bu çanta benimdir, seninki de bu.", error: "Zamir tekrarı ve belirtme hali karışıklığı", correct: "Bu çanta benim, o da senin." },
    { sentence: "Hava yağmurlu olduğu için şemsiye aldım.", error: "Bağlaç kullanımı doğru ama cümle yapısı sadeleştirilebilir", correct: "Hava yağmurluydu, şemsiye aldım." },
    { sentence: "Öğretmen derse girdi, öğrenciler ayağa kalktı.", error: "İki bağımsız cümle virgülle birleştirilemez, nokta veya bağlaç gerekir", correct: "Öğretmen derse girdi. Öğrenciler ayağa kalktı." },
  ],
  // Anlam farkları
  wordPairs: [
    { word1: "huzur", word2: "mutluluk", diff: "Huzur: içsel huzur, sakinlik, uzun süreli; Mutluluk: anlık keyif, coşku, geçici" },
    { word1: "anlamak", word2: "kavramak", diff: "Anlamak: bilgi işleme, zihinsel çözümleme; Kavramak: derinlemesine özümseme, içselleştirme" },
    { word1: "bakmak", word2: "göz atmak", diff: "Bakmak: genel görme eylemi; Göz atmak: hızlı, dikkatsiz bir bakış" },
    { word1: "duymak", word2: "işitmek", diff: "Duymak: ses algılama (pasif); İşitmek: kasten dinleme, anlama çabası (aktif)" },
    { word1: "yürümek", word2: "gezmek", diff: "Yürümek: ayakla ilerleme eylemi; Gezmek: amaçsız, keyif için dolaşma" },
  ],
  // Yazım hataları
  spellingErrors: [
    { sentence: "Yarın okula gidecegim.", errors: ["gidecegim → gideceğim"], correct: "Yarın okula gideceğim." },
    { sentence: "Arkadasimla bulustuk.", errors: ["Arkadasimla → Arkadaşımla", "bulustuk → buluştuk"], correct: "Arkadaşımla buluştuk." },
    { sentence: "Cok guzel bir gun.", errors: ["Cok → Çok", "guzel → güzel", "gun → gün"], correct: "Çok güzel bir gün." },
    { sentence: "Tesekkur ederim.", errors: ["Tesekkur → Teşekkür"], correct: "Teşekkür ederim." },
    { sentence: "Lutfen buraya gelin.", errors: ["Lutfen → Lütfen"], correct: "Lütfen buraya gelin." },
  ],
  // Cümle kurma kelimeleri
  sentenceWords: [
    { words: "kitap, oku, Ahmet, dün", correct: "Ahmet dün kitap okudu." },
    { words: "güzel, çiçek, bahçe, açtı", correct: "Bahçede güzel çiçekler açtı." },
    { words: "hızlı, koş, çocuk, park", correct: "Çocuk parkta hızlı koştu." },
    { words: "yaz, mektup, anne, sevgi", correct: "Anne sevgiyle mektup yazdı." },
    { words: "çalış, öğrenci, sınav, için", correct: "Öğrenci sınav için çalıştı." },
  ],
  // Sözcük türetme
  wordDerivation: [
    { root: "güz", suffixes: ["-el", "-el-lik", "-el-li", "-el-siz"], correct: ["güzel", "güzellik", "güzelli", "güzelsiz"] },
    { root: "bil", suffixes: ["-gi", "-gi-li", "-gi-siz", "-im"], correct: ["bilgi", "bilgili", "bilgisiz", "bilim"] },
    { root: "yaz", suffixes: ["-ı", "-ıcı", "-ıcılık", "-ın"], correct: ["yazı", "yazıcı", "yazıcılık", "yazın"] },
    { root: "git", suffixes: ["-iş", "-iş-li", "-iş-siz", "-id"], correct: ["gidiş", "gidişli", "gidişsiz", "gidim"] },
    { root: "oku", suffixes: ["-ma", "-ma-cı", "-ma-lık", "-yu"], correct: ["okuma", "okumacı", "okumalık", "okuyu"] },
  ],
  // Paragraf tutarlılığı
  paragraphTexts: [
    { text: "Ahmet sabah erken kalktı. Kahvaltısını yaptı. Okula gitti. Dersleri dinledi. Eve döndü. Ödevlerini yaptı. Akşam yemeğini yedi. Televizyon seyretti. Uyudu.", inconsistent: "Bu paragraf çok basit cümlelerden oluşuyor, bağlaçlarla birleştirilebilir." },
    { text: "İstanbul Türkiye'nin en kalabalık şehridir. Boğazı çok güzeldir. Tarihi yerleri çoktur. Her yıl milyonlarca turist gelir. Trafiği çok kötüdür. Ulaşım sorunu büyüktür.", inconsistent: "Paragraf konu bütünlüğü sağlamıyor; tanıtım ile şikayet karışık." },
  ],
  // Edebi metinler
  literaryTexts: [
    { text: "\"Yağmur damlaları pencereme vurduğunda, içimdeki hüzün de damla damla akan bir şiir gibiydi.\" — Bu cümlede kullanılan **sanat yolu** nedir?", answer: "Benzetme (Metafor) — yağmur damlaları ile hüzün benzetilmiştir" },
    { text: "\"Rüzgâr fısıldadı, yapraklar dans etti, güneş gülümsedi.\" — Bu cümlede kullanılan **sanat yolu** nedir?", answer: "Kişileştirme (Personification) — cansız varlıklara insan özelliği verilmiştir" },
  ],
};

/** Rastgele seçim yardımcı fonksiyonu */
function pickRandom<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

/** Benzersiz rastgele seçim */
function pickDistinct<T>(arr: T[], n: number): T[] {
  const shuffled = [...arr].sort(() => Math.random() - 0.5);
  return shuffled.slice(0, n);
}

/** Türkçe benchmark sorularını üret (10 soru, her alt kategoriden 1) */
export function generateTurkishQuestions(): BenchmarkQuestion[] {
  const questions: BenchmarkQuestion[] = [];
  let idCounter = 200; // 200-209 arası ID'ler (turkish_general kategorisi)

  // 1. Ekim yanlışı - 1
  const ekim1 = pickRandom(DYNAMIC_PARAMS.ekimSentences);
  questions.push({
    id: idCounter++,
    question: TURKISH_QUESTION_TEMPLATES[0].template
      .replace('{sentence}', ekim1.sentence)
      .replace('{rule}', ekim1.rule),
    category: 'turkish_general',
    evaluationParams: {
      subcategory: 'ekim',
      expectedAnswer: ekim1.correct,
      expectedPattern: 'DÜZELTME:',
      templateId: 'turkish-ekim-1',
    },
    isDynamic: true,
  });

  // 2. Ekim yanlışı - 2
  const ekim2 = pickRandom(DYNAMIC_PARAMS.ekimWords);
  questions.push({
    id: idCounter++,
    question: TURKISH_QUESTION_TEMPLATES[1].template
      .replace('{word}', ekim2.word)
      .replace('{suffix}', ekim2.suffix)
      .replace('{rule}', ekim2.rule),
    category: 'turkish_general',
    evaluationParams: {
      subcategory: 'ekim',
      expectedAnswer: ekim2.correct,
      expectedPattern: 'DÜZELTME:',
      templateId: 'turkish-ekim-2',
    },
    isDynamic: true,
  });

  // 3. Deyim anlamı - 1
  const idiom1 = pickRandom(DYNAMIC_PARAMS.idioms);
  questions.push({
    id: idCounter++,
    question: TURKISH_QUESTION_TEMPLATES[2].template
      .replace('{idiom}', idiom1.idiom),
    category: 'turkish_general',
    evaluationParams: {
      subcategory: 'deyim',
      expectedAnswer: idiom1.meaning,
      expectedPattern: 'ANLAM:',
      templateId: 'turkish-deyim-1',
    },
    isDynamic: true,
  });

  // 4. Deyim bulma - 2
  const idiom2 = pickRandom(DYNAMIC_PARAMS.idioms.filter(i => i.idiom !== idiom1.idiom));
  questions.push({
    id: idCounter++,
    question: TURKISH_QUESTION_TEMPLATES[3].template
      .replace('{situation}', idiom2.situation),
    category: 'turkish_general',
    evaluationParams: {
      subcategory: 'deyim',
      expectedAnswer: idiom2.idiom,
      expectedPattern: 'DEYİM:',
      templateId: 'turkish-deyim-2',
    },
    isDynamic: true,
  });

  // 5. Özet - 1
  const summary1 = pickRandom(DYNAMIC_PARAMS.summaryTexts);
  questions.push({
    id: idCounter++,
    question: TURKISH_QUESTION_TEMPLATES[4].template
      .replace('{maxWords}', String(summary1.maxWords))
      .replace('{text}', summary1.text),
    category: 'turkish_general',
    evaluationParams: {
      subcategory: 'ozet',
      expectedAnswer: summary1.summary,
      expectedPattern: 'ÖZET:',
      templateId: 'turkish-ozet-1',
      maxWords: summary1.maxWords,
    },
    isDynamic: true,
  });

  // 6. Özet + Başlık - 2
  const summary2 = pickRandom(DYNAMIC_PARAMS.summaryTexts.filter(s => s.text !== summary1.text));
  questions.push({
    id: idCounter++,
    question: TURKISH_QUESTION_TEMPLATES[5].template
      .replace('{text}', summary2.text),
    category: 'turkish_general',
    evaluationParams: {
      subcategory: 'ozet',
      expectedAnswer: summary2.summary,
      expectedPattern: 'BAŞLIK:|ÖZET:',
      templateId: 'turkish-ozet-2',
    },
    isDynamic: true,
  });

  // 7. Dilbilgisi
  const grammar = pickRandom(DYNAMIC_PARAMS.grammarErrors);
  questions.push({
    id: idCounter++,
    question: TURKISH_QUESTION_TEMPLATES[6].template
      .replace('{sentence}', grammar.sentence),
    category: 'turkish_general',
    evaluationParams: {
      subcategory: 'dilbilgisi',
      expectedAnswer: grammar.correct,
      expectedPattern: 'DÜZELTME:|HATA:',
      templateId: 'turkish-dilbilgisi-1',
    },
    isDynamic: true,
  });

  // 8. Anlam ayrımı
  const wordPair = pickRandom(DYNAMIC_PARAMS.wordPairs);
  questions.push({
    id: idCounter++,
    question: TURKISH_QUESTION_TEMPLATES[7].template
      .replace('{word1}', wordPair.word1)
      .replace('{word2}', wordPair.word2),
    category: 'turkish_general',
    evaluationParams: {
      subcategory: 'anlam',
      expectedAnswer: wordPair.diff,
      expectedPattern: 'FARK:|ÖRNEK1:|ÖRNEK2:',
      templateId: 'turkish-anlam-1',
    },
    isDynamic: true,
  });

  // 9. Yazım
  const spelling = pickRandom(DYNAMIC_PARAMS.spellingErrors);
  questions.push({
    id: idCounter++,
    question: TURKISH_QUESTION_TEMPLATES[8].template
      .replace('{sentence}', spelling.sentence),
    category: 'turkish_general',
    evaluationParams: {
      subcategory: 'yazim',
      expectedAnswer: spelling.correct,
      expectedPattern: 'DÜZELTME:|HATALAR:',
      templateId: 'turkish-yazim-1',
    },
    isDynamic: true,
  });

  // 10. Cümle kurma (son soru - sabit kalabilir veya rastgele)
  const sentence = pickRandom(DYNAMIC_PARAMS.sentenceWords);
  questions.push({
    id: idCounter++,
    question: TURKISH_QUESTION_TEMPLATES[9].template
      .replace('{words}', sentence.words),
    category: 'turkish_general',
    evaluationParams: {
      subcategory: 'cumle',
      expectedAnswer: sentence.correct,
      expectedPattern: 'CÜMLE:',
      templateId: 'turkish-cumle-1',
    },
    isDynamic: true,
  });

  return questions;
}

/** Türkçe sorular için deterministik değerlendirme fonksiyonu */
export function evaluateTurkishAnswer(
  answer: string,
  question: BenchmarkQuestion
): { score: number; details: string } {
  const params = question.evaluationParams as Record<string, unknown>;
  const expectedPattern = params.expectedPattern as string;
  const expectedAnswer = params.expectedAnswer as string;
  const subcategory = params.subcategory as string;

  // Format kontrolü
  const patternParts = expectedPattern.split('|');
  let formatCompliant = true;
  for (const part of patternParts) {
    if (!answer.includes(part)) {
      formatCompliant = false;
      break;
    }
  }

  // İçerik kontrolü (basit anahtar kelime/eşleşme)
  let contentScore = 0;
  const answerLower = answer.toLowerCase();
  const expectedLower = expectedAnswer.toLowerCase();

  // Alt kategoriye göre özel mantık
  switch (subcategory) {
    case 'ekim':
    case 'dilbilgisi':
    case 'yazim':
    case 'cumle':
      // Tam eşleşme veya çok yakın
      contentScore = answerLower.includes(expectedLower) ? 100 : 
                     (levenshteinSimilarity(answerLower, expectedLower) > 0.8 ? 70 : 0);
      break;
    case 'deyim':
      // Deyim veya anlam anahtar kelimeleri
      const idiomKeywords = expectedLower.split(' ').filter(w => w.length > 3);
      const matched = idiomKeywords.filter(k => answerLower.includes(k)).length;
      contentScore = matched / idiomKeywords.length * 100;
      break;
    case 'ozet':
      // Özet: anahtar kelimeler ve uzunluk kontrolü
      const summaryKeywords = expectedLower.split(' ').filter(w => w.length > 3);
      const matchedSummary = summaryKeywords.filter(k => answerLower.includes(k)).length;
      const lengthOk = answer.split(' ').length <= (params.maxWords as number || 50) * 1.5;
      contentScore = (matchedSummary / summaryKeywords.length * 80) + (lengthOk ? 20 : 0);
      break;
    case 'anlam':
      // Fark açıklaması + örnekler
      contentScore = answerLower.includes('fark') && answerLower.includes('örnek') ? 80 : 50;
      break;
    case 'sozcuk':
      // Türetmeler
      contentScore = answerLower.includes('türetiler') || answerLower.includes('türetler') ? 80 : 0;
      break;
    default:
      contentScore = 50;
  }

  const finalScore = Math.round((formatCompliant ? 1 : 0) * 30 + contentScore * 0.7);
  return {
    score: Math.min(100, Math.max(0, finalScore)),
    details: `Format: ${formatCompliant ? 'OK' : 'FAIL'}, Content: ${Math.round(contentScore)}%`,
  };
}

/** Levenshtein benzerlik (basit) */
function levenshteinSimilarity(a: string, b: string): number {
  if (a === b) return 1;
  if (a.length === 0 || b.length === 0) return 0;
  
  const matrix = Array(b.length + 1).fill(null).map(() => Array(a.length + 1).fill(0));
  for (let i = 0; i <= a.length; i++) matrix[0][i] = i;
  for (let j = 0; j <= b.length; j++) matrix[j][0] = j;
  
  for (let j = 1; j <= b.length; j++) {
    for (let i = 1; i <= a.length; i++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      matrix[j][i] = Math.min(
        matrix[j][i - 1] + 1,
        matrix[j - 1][i] + 1,
        matrix[j - 1][i - 1] + cost
      );
    }
  }
  
  const maxLen = Math.max(a.length, b.length);
  return 1 - matrix[b.length][a.length] / maxLen;
}