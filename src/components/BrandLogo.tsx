import type { ImgHTMLAttributes } from "react";
import { useTheme } from "../store/useTheme";

type Variant = "icon" | "logo" | "banner" | "splash";

interface BrandLogoProps extends Omit<ImgHTMLAttributes<HTMLImageElement>, "src" | "alt"> {
  variant?: Variant;
  alt?: string;
}

export function BrandLogo({ variant = "logo", alt = "Overcode", ...img }: BrandLogoProps) {
  const theme = useTheme((s) => s.theme);
  const suffix = variant === "icon" ? "" : `-${theme}`;
  return <img src={`brand/current/overcode-${variant}${suffix}.svg`} alt={alt} {...img} />;
}
