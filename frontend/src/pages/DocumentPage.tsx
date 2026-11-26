/** /documents/:id — карточка документа отдельной страницей: свойства, связи с записями, версии. */
import { Link, useParams } from "react-router-dom";

import { DocumentCard } from "@/components/DocumentCard";
import { EmptyState } from "@/components/ui";
import { useAuth } from "@/store/auth";

export default function DocumentPage() {
  const { id } = useParams();
  const canManageAll = useAuth((s) => s.can("files.delete") || !!s.me?.current_tenant?.is_owner);
  if (!id || !/^\d+$/.test(id)) {
    return <EmptyState title="Документ не найден" action={<Link to="/documents" className="btn-secondary">К документам</Link>} />;
  }
  return <DocumentCard key={id} docId={Number(id)} canManageAll={canManageAll} onClose={() => {}} variant="page" />;
}
