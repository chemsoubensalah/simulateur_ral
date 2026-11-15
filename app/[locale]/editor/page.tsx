import { notFound } from "next/navigation";
import { isLocale } from "@/lib/i18n/config";
import { Editor } from "@/components/editor/Editor";

export default async function EditorPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();
  return <Editor />;
}
