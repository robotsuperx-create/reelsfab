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
- **Design Movement**: غرفة التحكم الإذاعية / جناح المونتاج السينمائي (Broadcast Control Room).
- **Core Principles**: كثافة معلومات بلا ضجيج؛ الحالة مرئية دائمًا كأضواء البث؛ كل شاشة خط إنتاج يتحرك من اليمين لليسار؛ أرقام دقيقة بخط أحادي.
- **Color Philosophy**: خلفية جرافيت داكنة تريح العين لساعات المراجعة، ألوان الحالة فقط هي الملونة (أخضر موافقة، كهرماني مراجعة، أحمر رفض)، والكهرماني هو "ضوء التسجيل".
- **Layout Paradigm**: شريط تنقل رأسي يمين الشاشة + "شريط فيلم" أفقي للمراحل أعلى لوحة التحكم + مساحات عمل مقسومة (قائمة/محرر/معاينة 9:16).
- **Signature Elements**: ثقوب شريط الفيلم كفواصل، رموز زمنية (00:15) بخط أحادي، نقاط Tally مضيئة للحالة.
- **Interaction Philosophy**: كل إجراء جماعي بنقرة واحدة مع تقدم مرئي؛ لوحات قابلة للنسخ (Prompts/Captions) بنقرة.
- **Animation**: انتقالات قصيرة 150–200ms، نبض خفيف لضوء الحالة أثناء الرندر، شريط تقدم متصل.
- **Typography System**: Readex Pro للعناوين، IBM Plex Sans Arabic للنصوص، JetBrains Mono للأرقام والأزمنة.
- **Brand Essence**: مصنع ريلات داخلي يحوّل ملف شخصيات إلى 30 ريل يوميًا بأقل تكلفة — منضبط، سريع، صادق.
- **Brand Voice**: مباشر وعملي. أمثلة: "دفعة اليوم جاهزة: 30 نصًا بانتظار الرندر." / "3 ريلات تحتاج عينك قبل النشر."
- **Wordmark & Logo**: إطار ريل عمودي 9:16 بداخله نقطة تسجيل كهرمانية + "REELS/FAB" بخط Readex Pro عريض.
- **Signature Brand Color**: Tally Amber ‎#FFB627.
