import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { trpc } from "@/lib/trpc";
import { Sparkles } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

export default function CharacterGeneratorDialog({ onSaved }: { onSaved?: () => void }) {
  const [open, setOpen] = useState(false); const [description, setDescription] = useState(""); const [provider, setProvider] = useState<"anthropic"|"openai"|"gemini">("anthropic"); const [model, setModel] = useState("claude-sonnet-4-6"); const [generated, setGenerated] = useState<any>(null);
  const utils = trpc.useUtils();
  const generate = trpc.characterGenerator.generate.useMutation({ onSuccess: r => { setGenerated(r.character); toast.success("تم توليد ملف الشخصية — راجعه قبل الحفظ"); }, onError: e => toast.error(e.message) });
  const create = trpc.characters.create.useMutation({ onSuccess: () => { toast.success("تمت إضافة الشخصية"); utils.characters.list.invalidate(); setOpen(false); setGenerated(null); setDescription(""); onSaved?.(); }, onError: e => toast.error(e.message) });
  const choose = (p: typeof provider) => { setProvider(p); setModel(p === "anthropic" ? "claude-sonnet-4-6" : p === "openai" ? "gpt-5-mini" : "gemini-3.8-flash"); };
  return <Dialog open={open} onOpenChange={setOpen}><DialogTrigger asChild><Button><Sparkles/> شخصية جديدة بالذكاء الاصطناعي</Button></DialogTrigger><DialogContent className="max-h-[90vh] max-w-2xl overflow-y-auto"><DialogHeader><DialogTitle>إنشاء شخصية من وصف</DialogTitle></DialogHeader><div className="grid gap-4"><div><Label>صف الشخصية بالتفصيل</Label><Textarea className="mt-1 min-h-28" value={description} onChange={e=>setDescription(e.target.value)} placeholder="مثال: رجل بريطاني عمره 55 سنة، خبير أعمال ساخر، يقدم نصائح قصيرة لرواد الأعمال..."/></div><div className="grid grid-cols-2 gap-3"><div><Label>المزوّد</Label><Select value={provider} onValueChange={v=>choose(v as typeof provider)}><SelectTrigger className="mt-1"><SelectValue/></SelectTrigger><SelectContent><SelectItem value="anthropic">Claude</SelectItem><SelectItem value="openai">ChatGPT / OpenAI</SelectItem><SelectItem value="gemini">Gemini</SelectItem></SelectContent></Select></div><div><Label>النموذج</Label><input className="mt-1 h-9 w-full rounded-md border bg-background px-3 text-sm" value={model} onChange={e=>setModel(e.target.value)}/></div></div><div className="flex gap-2"><Button onClick={()=>generate.mutate({description,provider,model})} disabled={generate.isPending||description.trim().length<20}>{generate.isPending?"جارٍ التوليد…":"ولّد الملف"}</Button>{generated&&<Button variant="outline" onClick={()=>create.mutate({...generated, nameAr:generated.nameAr||null})} disabled={create.isPending}>حفظ الشخصية</Button>}</div>{generated&&<pre className="max-h-80 overflow-auto rounded-md border bg-black/20 p-3 text-xs" dir="ltr">{JSON.stringify(generated,null,2)}</pre>}</div></DialogContent></Dialog>;
}
