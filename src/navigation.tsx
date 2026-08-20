'use client';

import {
  createContext,
  useCallback,
  useContext,
  type AnchorHTMLAttributes,
  type MouseEvent,
  type ReactNode,
} from 'react';

interface Navigator {
  push(to: string): void;
  replace(to: string): void;
}

// Supplied by App, which owns the history state. A default that falls back to a
// full page load keeps a stray <Link> outside the provider working rather than
// silently doing nothing.
const NavigationContext = createContext<Navigator>({
  push: (to) => {
    window.location.assign(to);
  },
  replace: (to) => {
    window.location.replace(to);
  },
});

export function NavigationProvider({
  children,
  value,
}: {
  children: ReactNode;
  value: Navigator;
}) {
  return (
    <NavigationContext.Provider value={value}>
      {children}
    </NavigationContext.Provider>
  );
}

export function useRouter(): Navigator {
  return useContext(NavigationContext);
}

type LinkProps = Omit<AnchorHTMLAttributes<HTMLAnchorElement>, 'href'> & {
  href: string;
  children: ReactNode;
};

// A stand-in for next/link: renders a real anchor, so middle-click, modifiers
// and "copy link address" all behave, but routes in-app on a plain click.
export function Link({ href, children, onClick, ...rest }: LinkProps) {
  const router = useRouter();
  const handleClick = useCallback(
    (event: MouseEvent<HTMLAnchorElement>) => {
      onClick?.(event);
      if (event.defaultPrevented) return;
      // Let the browser handle anything that is not a plain left click, and
      // anything leaving the app.
      if (
        event.button !== 0 ||
        event.metaKey ||
        event.ctrlKey ||
        event.shiftKey ||
        event.altKey ||
        rest.target === '_blank' ||
        /^[a-z]+:/i.test(href)
      ) {
        return;
      }
      event.preventDefault();
      router.push(href);
    },
    [href, onClick, rest.target, router]
  );

  return (
    <a href={href} onClick={handleClick} {...rest}>
      {children}
    </a>
  );
}
