import {
  ArrowLeftRight,
  Bike,
  CircleEllipsis,
  Dumbbell,
  Gift,
  GraduationCap,
  HandCoins,
  HeartPulse,
  Home,
  Landmark,
  PartyPopper,
  PiggyBank,
  Plane,
  Repeat,
  Shirt,
  ShoppingBasket,
  Stethoscope,
  Users,
  Utensils,
  Wallet,
  Wifi,
  Zap,
  type LucideIcon,
} from "lucide-react";
import { categoryLook, type IconKey } from "@/lib/view/categories";

const ICONS: Record<IconKey, LucideIcon> = {
  home: Home,
  zap: Zap,
  wifi: Wifi,
  "heart-pulse": HeartPulse,
  "shopping-basket": ShoppingBasket,
  utensils: Utensils,
  "party-popper": PartyPopper,
  bike: Bike,
  dumbbell: Dumbbell,
  repeat: Repeat,
  "graduation-cap": GraduationCap,
  shirt: Shirt,
  stethoscope: Stethoscope,
  plane: Plane,
  gift: Gift,
  "piggy-bank": PiggyBank,
  "circle-ellipsis": CircleEllipsis,
  wallet: Wallet,
  landmark: Landmark,
  "hand-coins": HandCoins,
  users: Users,
  "arrow-left-right": ArrowLeftRight,
};

/** The 40px tinted square in front of every row. */
export function CategoryIcon({ name }: { name: string | null }) {
  const { chip, icon } = categoryLook(name);
  const Icon = ICONS[icon];
  return (
    <span
      aria-hidden
      className="grid size-10 shrink-0 place-items-center rounded-xl"
      style={{ background: `var(--chip-${chip})`, color: `var(--chip-${chip}-ink)` }}
    >
      <Icon className="size-5" />
    </span>
  );
}
