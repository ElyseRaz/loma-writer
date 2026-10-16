import { Check, Eye, MessageSquarePlus, ScanEye, Globe, GitCompare, X } from "lucide-react";
import { useApp } from "../../state/store";
import { CommandButton, RibbonButton } from "../ui/RibbonButton";
import { RibbonGroup, RibbonStack } from "./RibbonParts";

export function ReviewTab() {
  return (
    <>
      <RibbonGroup label="Vérification">
        <CommandButton id="review.spell" size="lg" label="Orthographe" />
        <CommandButton id="review.wordCount" size="lg" label="Statistiques" />
      </RibbonGroup>
      <RibbonGroup label="Commentaires">
        <RibbonButton icon={MessageSquarePlus} size="lg" label="Nouveau commentaire" soon />
      </RibbonGroup>
      <RibbonGroup label="Suivi">
        <RibbonButton icon={GitCompare} size="lg" label="Suivi des modifications" soon />
        <RibbonStack>
          <RibbonButton icon={Check} size="sm" label="Accepter" soon className="w-[88px] justify-start" />
          <RibbonButton icon={X} size="sm" label="Refuser" soon className="w-[88px] justify-start" />
        </RibbonStack>
      </RibbonGroup>
    </>
  );
}

export function ViewTab() {
  const { state } = useApp();
  return (
    <>
      <RibbonGroup label="Affichage">
        <RibbonButton icon={Eye} size="lg" label="Mise en page" active title="Mode Page (seul mode disponible)" />
        <RibbonButton icon={Globe} size="lg" label="Web" soon />
        <RibbonButton icon={ScanEye} size="lg" label="Lecture" soon />
      </RibbonGroup>
      <RibbonGroup label="Afficher">
        <RibbonStack>
          <CommandButton id="view.ruler" size="sm" label="Règle" className="w-[120px] justify-start" />
          <CommandButton id="view.bounds" size="sm" label="Limites du texte" className="w-[120px] justify-start" />
          <CommandButton id="view.nav" size="sm" label="Volet de navigation" className="w-[120px] justify-start" />
          <CommandButton id="para.marks" size="sm" label="Marques ¶" className="w-[120px] justify-start" />
        </RibbonStack>
      </RibbonGroup>
      <RibbonGroup label="Signets">
        <CommandButton id="view.bookmarks" size="lg" label="Afficher" />
      </RibbonGroup>
      <RibbonGroup label="Zoom">
        <CommandButton id="view.zoomOut" size="lg" label="Zoom −" />
        <CommandButton id="view.zoom100" size="lg" label={`${state.zoom} %`} />
        <CommandButton id="view.zoomIn" size="lg" label="Zoom +" />
      </RibbonGroup>
      <RibbonGroup label="Thème">
        <CommandButton id="view.themeLight" size="lg" label="Clair" />
        <CommandButton id="view.themeDark" size="lg" label="Sombre" />
      </RibbonGroup>
    </>
  );
}
