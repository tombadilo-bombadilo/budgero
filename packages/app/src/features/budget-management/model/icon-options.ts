import React from 'react';
import {
  // Home & Living
  Home,
  Building,
  Car,
  Utensils,
  ShoppingCart,
  Lightbulb,
  Tv,
  Wifi,
  Smartphone,
  WashingMachine,
  // Personal & Family
  Users,
  Baby,
  HeartPulse,
  Glasses,
  BookOpen,
  GraduationCap,
  Stethoscope,
  // Finance & Money
  PiggyBank,
  DollarSign,
  CreditCard,
  Banknote,
  TrendingUp,
  TrendingDown,
  PieChart,
  Target,
  // Transportation
  Plane,
  Train,
  Bus,
  Bike,
  Ship,
  // Entertainment & Leisure
  Music,
  Gamepad2,
  Camera,
  Book,
  Coffee,
  Gift,
  Ticket,
  // Utilities & Bills
  Zap,
  Droplet,
  Wind,
  Shield,
  FileText,
  // Shopping & Services
  Shirt,
  Scissors,
  Dumbbell,
  Dog,
  Cat,
  TreePine,
  // Miscellaneous
  Star,
  Heart,
  Bell,
  Calendar,
  MapPin,
  Briefcase,
  Crown,
} from 'lucide-react';

export interface IconOption {
  value: string;
  label: string;
  component: React.ElementType;
}

export const iconOptions: IconOption[] = [
  // Home & Living
  { value: 'Home', label: 'Home & Rent', component: Home },
  { value: 'Building', label: 'Property', component: Building },
  { value: 'Car', label: 'Auto & Transport', component: Car },
  { value: 'Utensils', label: 'Groceries & Food', component: Utensils },
  { value: 'ShoppingCart', label: 'Shopping', component: ShoppingCart },
  { value: 'Lightbulb', label: 'Utilities', component: Lightbulb },
  { value: 'Tv', label: 'Entertainment', component: Tv },
  { value: 'Wifi', label: 'Internet & Phone', component: Wifi },
  { value: 'Smartphone', label: 'Mobile', component: Smartphone },
  { value: 'WashingMachine', label: 'Household', component: WashingMachine },

  // Personal & Family
  { value: 'Heart', label: 'Personal Care', component: Heart },
  { value: 'Users', label: 'Family', component: Users },
  { value: 'Baby', label: 'Childcare', component: Baby },
  { value: 'HeartPulse', label: 'Health & Medical', component: HeartPulse },
  { value: 'Glasses', label: 'Vision', component: Glasses },
  { value: 'BookOpen', label: 'Education', component: BookOpen },
  { value: 'GraduationCap', label: 'School & Learning', component: GraduationCap },
  { value: 'Stethoscope', label: 'Healthcare', component: Stethoscope },

  // Finance & Money
  { value: 'PiggyBank', label: 'Savings', component: PiggyBank },
  { value: 'DollarSign', label: 'Income', component: DollarSign },
  { value: 'CreditCard', label: 'Credit Cards', component: CreditCard },
  { value: 'Banknote', label: 'Cash', component: Banknote },
  { value: 'TrendingUp', label: 'Investments', component: TrendingUp },
  { value: 'TrendingDown', label: 'Debt', component: TrendingDown },
  { value: 'PieChart', label: 'Budgeting', component: PieChart },
  { value: 'Target', label: 'Goals', component: Target },

  // Transportation
  { value: 'Plane', label: 'Travel & Vacation', component: Plane },
  { value: 'Train', label: 'Public Transit', component: Train },
  { value: 'Bus', label: 'Bus & Transit', component: Bus },
  { value: 'Bike', label: 'Cycling', component: Bike },
  { value: 'Ship', label: 'Travel', component: Ship },

  // Entertainment & Leisure
  { value: 'Music', label: 'Music & Streaming', component: Music },
  { value: 'Gamepad2', label: 'Gaming', component: Gamepad2 },
  { value: 'Camera', label: 'Photography', component: Camera },
  { value: 'Book', label: 'Reading', component: Book },
  { value: 'Coffee', label: 'Dining Out', component: Coffee },
  { value: 'Gift', label: 'Gifts & Donations', component: Gift },
  { value: 'Ticket', label: 'Events & Tickets', component: Ticket },

  // Utilities & Bills
  { value: 'Zap', label: 'Electricity', component: Zap },
  { value: 'Droplet', label: 'Water', component: Droplet },
  { value: 'Wind', label: 'Gas', component: Wind },
  { value: 'Shield', label: 'Insurance', component: Shield },
  { value: 'FileText', label: 'Bills & Documents', component: FileText },

  // Shopping & Services
  { value: 'Shirt', label: 'Clothing', component: Shirt },
  { value: 'Scissors', label: 'Hair & Beauty', component: Scissors },
  { value: 'Dumbbell', label: 'Fitness & Gym', component: Dumbbell },
  { value: 'Dog', label: 'Pets', component: Dog },
  { value: 'Cat', label: 'Pet Care', component: Cat },
  { value: 'TreePine', label: 'Garden & Outdoor', component: TreePine },

  // Miscellaneous
  { value: 'Star', label: 'Favorites', component: Star },
  { value: 'Bell', label: 'Reminders', component: Bell },
  { value: 'Calendar', label: 'Planning', component: Calendar },
  { value: 'MapPin', label: 'Location', component: MapPin },
  { value: 'Briefcase', label: 'Business', component: Briefcase },
  { value: 'Crown', label: 'Luxury', component: Crown },
];

/**
 * Resolves a budget badge icon value to its lucide component class.
 * Returns null when the value does not match a known icon option.
 * Call sites render the component with their own size, e.g.
 * `const Icon = getBudgetIconComponent(value); return Icon ? <Icon className="h-4 w-4" /> : fallback;`
 */
export function getBudgetIconComponent(badgeIcon: string): React.ElementType | null {
  return iconOptions.find((icon) => icon.value === badgeIcon)?.component ?? null;
}
