# خادم صوتك المستنسخ (voice-server)

خادم صغير يحوّل نموذج استنساخ صوت مفتوح المصدر إلى نقطة نهاية متوافقة مع OpenAI (`/v1/audio/speech`)،
فيستخدمها ReellllLocaL كمزوّد «الصوت» للتعليق العربي في الحلقات الطويلة — بصوتك أنت.

## النماذج المدعومة

| `VOICE_BACKEND` | النموذج | الرخصة | العربية | الاستنساخ | العتاد |
|---|---|---|---|---|---|
| `chatterbox` (افتراضي) | [Chatterbox Multilingual V3](https://github.com/resemble-ai/chatterbox) | MIT | نعم (`ar`) | من مقطع 10–20 ث | GPU 4GB+ (أو CPU بطيء) |
| `audio8` | [Audio8-TTS-Realistic-0.6b](https://huggingface.co/Edge0/Audio8-TTS-Realistic-0.6b) (أكتوبر 2026) | Apache-2.0 | نعم | مقطع + نص المقطع | GPU موصى به |
| `test` | نغمة اختبار | — | — | — | لا شيء |

## التشغيل

```bash
cd tools/voice-server
python -m venv .venv && source .venv/bin/activate        # Windows: .venv\Scripts\activate
pip install -r requirements.txt                          # torch + chatterbox-tts (أو transformers لـ audio8)
mkdir -p voices && cp ~/تسجيلي.wav voices/oussama.wav    # 10–20 ثانية، صوت نظيف بلا موسيقى، 24–48 kHz
VOICE_BACKEND=chatterbox VOICE_API_KEY=اختر-سرًا python server.py --port 8000
```

ثم في ReellllLocaL → مركز التكاملات → **الصوت**:
`baseUrl = http://127.0.0.1:8000/v1` · `apiKey = نفس السر` · `format = wav` · `extraJson = {"language":"ar"}`
وفي إعدادات القناة: محرّك الصوت = **OpenAI TTS أو خادم صوت متوافق**، الصوت = `oussama` (اسم الملف بلا `.wav`).

## بلا GPU على جهازك؟

- **Kaggle / Colab (مجاني):** شغّل الخادم في دفتر مع GPU، وافتح نفقًا (`cloudflared tunnel --url http://localhost:8000`
  أو ngrok)، وضع عنوان النفق في `baseUrl`. التعليق يُولَّد مرة واحدة لكل مشهد ويُخزَّن، فجلسة واحدة أسبوعيًا تكفي
  لتعليق كل حلقات الأسبوع.
- **خادم مؤجَّر بالثانية** (RunPod/Vast): نفس الأمر، بضعة سنتات للحلقة.
- **CPU فقط:** يعمل لكن ببطء (دقائق لكل مشهد على لابتوب)؛ اتركه يعمل ليلًا مع الاستوديو الآلي.

## ملاحظات

- Chatterbox يضيف علامة مائية غير مسموعة (PerTh) في كل ملف — لا تؤثر على يوتيوب.
- استخدم صوتك أنت أو صوتًا لديك إذن صريح باستنساخه؛ يوتيوب يطلب وسم «محتوى اصطناعي» عند تقليد صوت شخص حقيقي.
- الجمل الطويلة تُقسَّم تلقائيًا (`VOICE_MAX_CHUNK`، افتراضيًا 350 حرفًا) مع وقفة قصيرة بينها (`VOICE_PAUSE_MS`).
- `exaggeration` (0.25–2) و`cfg_weight` (0.2–1) يمكن تمريرهما في `extraJson` لضبط الأداء؛ للقراءة الوثائقية الهادئة
  جرّب `{"language":"ar","exaggeration":0.4,"cfg_weight":0.5}`.
