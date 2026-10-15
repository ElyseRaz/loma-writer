import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
  Award, BarChart3, Bell, BookOpen, Bookmark, Briefcase, Calendar, Camera, Check, CircleAlert, CircleCheck, CircleHelp, Clock, Cloud, Code, Download, Eye, File,
  Flag, Folder, Gift, Globe, Heart, House, Image, Info, Key, Laptop, Lightbulb, Link, Lock, Mail, MapPin, MessageSquare, Mic, Music, Phone, Rocket, Search, Settings,
  Share2, Shield, ShoppingCart, Smile, Star, Sun, Tag, Target, ThumbsUp, Trash2, TrendingUp, TriangleAlert, Truck, Upload, User, Users, Wifi, Wrench, X, Zap, type LucideIcon,
} from "lucide-react";
import { svgToPng } from "./raster";

export interface IconDef {
  id: string;
  label: string;
  icon: LucideIcon;
}

export const ICONS: IconDef[] = [
  { id: "check", label: "Coche", icon: Check }, { id: "x", label: "Croix", icon: X }, { id: "circle-check", label: "Validé", icon: CircleCheck },
  { id: "alert", label: "Avertissement", icon: TriangleAlert }, { id: "info", label: "Information", icon: Info }, { id: "help", label: "Aide", icon: CircleHelp },
  { id: "circle-alert", label: "Attention", icon: CircleAlert }, { id: "star", label: "Étoile", icon: Star }, { id: "heart", label: "Cœur", icon: Heart },
  { id: "thumbs-up", label: "J'aime", icon: ThumbsUp }, { id: "smile", label: "Sourire", icon: Smile }, { id: "flag", label: "Drapeau", icon: Flag },
  { id: "bookmark", label: "Marque-page", icon: Bookmark }, { id: "tag", label: "Étiquette", icon: Tag }, { id: "target", label: "Cible", icon: Target },
  { id: "award", label: "Récompense", icon: Award }, { id: "lightbulb", label: "Idée", icon: Lightbulb }, { id: "zap", label: "Éclair", icon: Zap },
  { id: "rocket", label: "Fusée", icon: Rocket }, { id: "trending-up", label: "Croissance", icon: TrendingUp }, { id: "bar-chart", label: "Statistiques", icon: BarChart3 },
  { id: "user", label: "Personne", icon: User }, { id: "users", label: "Équipe", icon: Users }, { id: "briefcase", label: "Mallette", icon: Briefcase },
  { id: "mail", label: "Courriel", icon: Mail }, { id: "phone", label: "Téléphone", icon: Phone }, { id: "message", label: "Message", icon: MessageSquare },
  { id: "map-pin", label: "Lieu", icon: MapPin }, { id: "globe", label: "Monde", icon: Globe }, { id: "home", label: "Maison", icon: House },
  { id: "calendar", label: "Calendrier", icon: Calendar }, { id: "clock", label: "Horloge", icon: Clock }, { id: "bell", label: "Cloche", icon: Bell },
  { id: "file", label: "Fichier", icon: File }, { id: "folder", label: "Dossier", icon: Folder }, { id: "book", label: "Livre", icon: BookOpen },
  { id: "image", label: "Image", icon: Image }, { id: "camera", label: "Appareil photo", icon: Camera }, { id: "music", label: "Musique", icon: Music },
  { id: "mic", label: "Micro", icon: Mic }, { id: "laptop", label: "Ordinateur", icon: Laptop }, { id: "code", label: "Code", icon: Code },
  { id: "wifi", label: "Réseau", icon: Wifi }, { id: "cloud", label: "Nuage", icon: Cloud }, { id: "download", label: "Télécharger", icon: Download },
  { id: "upload", label: "Envoyer", icon: Upload }, { id: "share", label: "Partager", icon: Share2 }, { id: "link", label: "Lien", icon: Link },
  { id: "lock", label: "Cadenas", icon: Lock }, { id: "key", label: "Clé", icon: Key }, { id: "shield", label: "Bouclier", icon: Shield },
  { id: "settings", label: "Réglages", icon: Settings }, { id: "wrench", label: "Outil", icon: Wrench }, { id: "search", label: "Recherche", icon: Search },
  { id: "eye", label: "Vue", icon: Eye }, { id: "trash", label: "Corbeille", icon: Trash2 }, { id: "cart", label: "Panier", icon: ShoppingCart },
  { id: "truck", label: "Livraison", icon: Truck }, { id: "gift", label: "Cadeau", icon: Gift }, { id: "sun", label: "Soleil", icon: Sun },
];

/** Renders an icon in the chosen colour as a PNG picture (editors other than Loma Writer cannot show vector icons). */
export function renderIcon(def: IconDef, color: string, size = 48) {
  const svg = renderToStaticMarkup(createElement(def.icon, { size: 96, color, strokeWidth: 1.75, xmlns: "http://www.w3.org/2000/svg" }));
  return svgToPng(svg.includes("xmlns=") ? svg : svg.replace("<svg", '<svg xmlns="http://www.w3.org/2000/svg"'), size, 3);
}
