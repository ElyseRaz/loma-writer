export interface DocumentTemplate {
  id: string;
  name: string;
  category: string;
  html: string;
}

export const TEMPLATES: DocumentTemplate[] = [
  { id: "blank", name: "Document vierge", category: "", html: "<p></p>" },
  {
    id: "letter",
    name: "Lettre",
    category: "Lettre",
    html: `<p style="text-align: right">Lieu, le 1er janvier 2026</p><p><strong>Nom du destinataire</strong><br>Adresse</p><p><strong>Objet :</strong> …</p><p>Madame, Monsieur,</p><p>Corps de la lettre…</p><p>Dans l'attente de votre réponse, je vous prie d'agréer, Madame, Monsieur, l'expression de mes salutations distinguées.</p><p>Signature</p>`,
  },
  {
    id: "report",
    name: "Rapport",
    category: "Pro",
    html: `<h1>Titre du rapport</h1><p><em>Auteur — Date</em></p><h2>1. Introduction</h2><p>Présentez le contexte et les objectifs.</p><h2>2. Développement</h2><p>Détaillez votre analyse.</p><h3>2.1 Sous-partie</h3><p>…</p><h2>3. Conclusion</h2><p>Résumez les points clés.</p>`,
  },
  {
    id: "minutes",
    name: "Compte-rendu",
    category: "Équipe",
    html: `<h1>Compte-rendu de réunion</h1><p><strong>Date :</strong> … <strong>Participants :</strong> …</p><h2>Ordre du jour</h2><ol><li><p>Point 1</p></li><li><p>Point 2</p></li></ol><h2>Décisions</h2><ul><li><p>…</p></li></ul><h2>Actions</h2><ul><li><p>Qui — quoi — pour quand</p></li></ul>`,
  },
];
