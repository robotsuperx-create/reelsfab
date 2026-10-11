# AI Reels Factory — خطة التنفيذ

## الهدف
نظام داخلي واحد يدير مصنع ريلات 15 ثانية لعشر شخصيات AI (من ملف Character Bible): من الفكرة إلى النص، ثم الإنتاج الهجين (30% Premium عبر Higgsfield + 70% اقتصادي يُصنع داخل النظام)، ثم فحص الجودة، والتقويم، والنشر، والتحليلات، والتكلفة، والأتمتة اليومية. الواجهة عربية (RTL) ولغة المحتوى إنجليزية.

## المعمارية
| الطبقة | التنفيذ |
| --- | --- |
| الواجهة | React 19 + Tailwind 4 + shadcn/ui، توجيه wouter، RTL كامل |
| الخادم | Express + tRPC (قالب web-db-user)، تسجيل دخول Manus، أدوار: user (بانتظار الموافقة) / member / admin |
| البيانات | MySQL عبر Drizzle: characters, assets, batches, scripts, premium_clips, renders, posts, post_metrics, cost_entries, settings, automation_runs, insights |
| الملفات | تخزين Manus (`storagePut`) — رفع عبر `/api/upload` وقراءة نفس الأصل عبر `/api/media/:key` حتى لا يتلوث الـCanvas |
| النصوص | LLM المدمج (`invokeLLM`) بمخرجات JSON Schema لتوليد دفعات النصوص، برومبتات Higgsfield، النسخ المشتقة، المراجعة، والتحليلات |
| الصوت المجاني | Kokoro-82M داخل المتصفح (Web Worker، kokoro.web.js من CDN) — تكلفة صفرية |
| الرندر المجاني | Canvas 2D + WebCodecs عبر mediabunny (H.264 + AAC، 1080×1920، 30fps، ≤15s) داخل متصفح الفريق — لا خوادم رندر |
| التفريغ | Whisper المدمج لاستخراج نص فيديوهات Premium (WAV مستخرج في المتصفح) لتوليد ترجمات النسخ المشتقة |
| الأتمتة | Heartbeat cron → `/api/scheduled/daily-batch` يولد دفعة اليوم ويرسل إشعارًا للمالك؛ الرندر الجماعي بنقرة واحدة في المتصفح |

## خط الإنتاج (حالات النص)
`idea → script_ready → (premium: prompt_ready → premium_uploaded) → rendered → qc → approved/needs_review/rejected → scheduled → published`

## القوالب الاقتصادية (5)
direct_tip، common_mistake، comparison، three_points، story_wisdom — لكل قالب حركة Ken Burns وتنسيق Hook وبطاقة CTA مختلفة، مع هوية ألوان وخط لكل شخصية ووسم "AI-generated character" ثابت.

## النسخ المشتقة من Premium
كل فيديو Higgsfield يُفرَّغ ثم يُولِّد LLM عدة Hooks/CTA بديلة؛ الرندر يعيد استخدام الفيديو نفسه مع Hook جديد، ترجمة، وبطاقة CTA → 3–5 ريلات من كل لقطة مدفوعة.

## فحص الجودة الآلي
مدة 13–15.5 ثانية، 1080×1920، وجود صوت، عدد كلمات 25–45، وسم AI، ترجمة، كشف ادعاءات الدخل/الصحة/الاستثمار، تكرار النص (Jaccard)، وفحص بصري اختياري بـLLM (تطابق الشخصية مع الصورة المرجعية) → Approved / Needs Review / Reject.

## هيكل المشروع
| المسار | المسؤولية |
| --- | --- |
| `drizzle/schema.ts` | الجداول |
| `server/db.ts` | دوال الاستعلام |
| `server/routers/*.ts` | راوترات tRPC لكل وحدة |
| `server/services/*.ts` | LLM (النصوص/المراجعة/التحليلات)، الامتثال، التكلفة، الأتمتة |
| `server/routes/media.ts` | رفع/قراءة الملفات + مسار الجدولة |
| `server/seed.ts` | الشخصيات العشر والإعدادات الافتراضية |
| `shared/domain.ts` | الثوابت المشتركة (القوالب، الحالات، الأصوات، القواعد) |
| `client/src/lib/render/*` | محرك الرندر (timeline, draw, encode, audio mix) |
| `client/src/lib/tts/*` | عامل Kokoro |
| `client/src/pages/*` | الصفحات |

## التصميم
- **Design Movement**: جناح إبداع سينمائي AI مستوحى من كثافة Higgsfield البصرية، لكن بعلامة REELS/FAB أصلية.
- **Core Principles**: أسود سينمائي؛ لون ليموني كهربائي واحد للقرارات؛ بطاقات تحريرية مستديرة؛ صور وفيديوهات هي الأبطال؛ واجهة سريعة بلا زخرفة زائدة.
- **Color Philosophy**: خلفية شبه سوداء تُبرز اللقطات، وElectric Lime للحالة والإجراء الأساسي، مع أخضر/أحمر فقط للمخرجات التشغيلية.
- **Layout Paradigm**: شريط جانبي نحيف + شبكة بطاقات مرنة + عناوين كبيرة ومساحات تنفس، مع معاينة 9:16 واضحة في صفحات الإنتاج.
- **Signature Elements**: علامة RF ليمونية متوهجة، فواصل نقاط مضيئة، وهالات ضوئية خفيفة حول البطاقات النشطة.
- **Interaction Philosophy**: كل بطاقة قابلة للتنفيذ مباشرة؛ الأزرار الأساسية عالية التباين؛ حالة التحميل والنجاح واضحة دون نوافذ مربكة.
- **Animation**: انتقالات 180ms، توهج نبضي عند النشاط، تكبير طفيف للبطاقات عند المرور، وحركة هادئة لا تنافس محتوى الفيديو.
- **Typography System**: Readex Pro للعناوين العربية الكبيرة، IBM Plex Sans Arabic للنصوص، JetBrains Mono للأرقام والأزمنة.
- **Brand Essence**: مصنع ريلات AI يحوّل الشخصيات إلى محتوى يومي — بصري، سريع، وقابل للتوسع.
- **Brand Voice**: مباشر وحماسي. أمثلة: "حوّل الفكرة إلى لقطة." / "دفعة اليوم جاهزة للرندر والنشر."
- **Wordmark & Logo**: مربع RF ليموني أصلي مع وهج سينمائي + REELS/FAB؛ لا يستخدم شعار Higgsfield أو علاماته.
- **Signature Brand Color**: Electric Lime ‎#DFFF00.
