import Image from "next/image";

/**
 * The PANDA logo: the panda's face. The picture has a pure-black background, so it is blended with `lighten`
 * — on the site's dark surfaces that background disappears and only the panda remains.
 */
export default function Logo({ size = 30, className = "" }: { size?: number; className?: string }) {
  return <Image src="/logo.png" alt="" width={size} height={size} className={`shrink-0 mix-blend-lighten ${className}`} priority={size >= 30} />;
}
