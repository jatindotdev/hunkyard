import type { CommentAuthor } from "@/lib/review/types";
import { cn } from "@/lib/cn";

interface CommentAuthorAvatarProps {
  author: CommentAuthor;
  className?: string;
}

function hashLogin(value: string): number {
  let hash = 5381;
  for (let i = 0; i < value.length; i++) {
    hash = ((hash << 5) + hash + value.charCodeAt(i)) >>> 0;
  }
  return hash;
}

// A hue derived from the login, at a fixed saturation and lightness that stays
// legible against both themes.
function chipColor(login: string): string {
  return `hsl(${hashLogin(login) % 360} 52% 45%)`;
}

// Renders a circular avatar for a comment author: the image GitHub gave us if
// there is one, otherwise the author's initial over a hue derived from their
// login, which needs no asset and cannot fail to load.
// Defaults to 32px (size-8); pass className to override for other sizes.
export function CommentAuthorAvatar({
  author,
  className,
}: CommentAuthorAvatarProps) {
  const { login, avatarUrl } = author;
  return (
    <div className="relative shrink-0 self-start after:absolute after:inset-0 after:z-10 after:block after:rounded-full after:border after:border-[rgb(0_0_0_/_0.1)] after:content-[''] dark:after:border-[rgb(255_255_255_/_0.1)]">
      {avatarUrl == null ? (
        <div
          aria-label={login}
          role="img"
          style={{ backgroundColor: chipColor(login) }}
          className={cn(
            "flex size-8 select-none items-center justify-center rounded-full font-sans text-[13px] font-medium uppercase leading-none text-white",
            className,
          )}
        >
          {login.charAt(0)}
        </div>
      ) : (
        <img
          alt={login}
          src={avatarUrl}
          className={cn("size-8 rounded-full", className)}
        />
      )}
    </div>
  );
}
