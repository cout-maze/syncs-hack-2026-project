import { blockIconColor, shadeHex, tintHex } from '@/lib/visuals';

/**
 * Cartoon icons for the nine block types.
 *
 * Flat two-tone vector, one per type, drawn on a 24x24 grid: a main tone from the
 * block's palette, a darker sibling for roofs and shadowed faces, white for glass.
 * Deliberately varied in SILHOUETTE - a house, a bus, a tree, a temple - because
 * nine rounded rectangles at 40px read as one repeated shape no matter how they are
 * coloured, which is the same problem the map renderer had.
 *
 * No frame, no plate, no tinted box: the shape is the icon.
 */

interface BlockIconProps {
  typeId: string;
  className?: string;
}

export function BlockIcon({ typeId, className }: BlockIconProps) {
  const c = blockIconColor(typeId);
  const dark = shadeHex(c, 0.72);
  const light = tintHex(c, 0.42);

  return (
    <svg viewBox="0 0 24 24" className={className} aria-hidden="true" role="presentation">
      {shapes(typeId, c, dark, light)}
    </svg>
  );
}

function shapes(typeId: string, c: string, dark: string, light: string) {
  switch (typeId) {
    /* A house: pitched roof, chimney, door and one window. Deliberately asymmetric -
       a door flanked by two matching windows reads as a face. */
    case 'housing':
      return (
        <>
          {/* Drawn before the roof, so only the stack above the slope shows. */}
          <rect x="16.6" y="3.4" width="2.6" height="5.4" rx="0.9" fill={dark} />
          <path d="M12 3.2 22.2 11.4a1 1 0 0 1-.62 1.78H2.42a1 1 0 0 1-.62-1.78Z" fill={dark} />
          <rect x="4.6" y="12.4" width="14.8" height="8.4" rx="1.4" fill={light} />
          <path d="M8.6 20.8v-4a2.3 2.3 0 0 1 4.6 0v4Z" fill={dark} />
          <rect x="14.8" y="14.8" width="3.4" height="3.4" rx="0.8" fill="#fff" />
        </>
      );

    /* Hospital: a block with a big white cross over a canopied entrance. */
    case 'healthcare':
      return (
        <>
          <rect x="3.6" y="5" width="16.8" height="14.2" rx="2.4" fill={c} />
          <rect x="10.7" y="7.4" width="2.6" height="7.6" rx="0.9" fill="#fff" />
          <rect x="8.2" y="9.9" width="7.6" height="2.6" rx="0.9" fill="#fff" />
          <rect x="9.6" y="16" width="4.8" height="3.2" rx="0.8" fill={dark} />
          <rect x="2.4" y="19.2" width="19.2" height="1.9" rx="0.9" fill={light} />
        </>
      );

    /* Education: an open book. The one shape nobody mistakes for a building. */
    case 'education':
      return (
        <>
          <path d="M11.3 7.6v11.8c-2.3-1.5-5-2-8.1-1.5a.9.9 0 0 1-1.1-.9V6.4a.9.9 0 0 1 .7-.9c3.2-.6 6 0 8.5 2.1Z" fill={light} />
          <path d="M12.7 7.6v11.8c2.3-1.5 5-2 8.1-1.5a.9.9 0 0 0 1.1-.9V6.4a.9.9 0 0 0-.7-.9c-3.2-.6-6 0-8.5 2.1Z" fill={c} />
          <path d="M11.3 7.6v11.8a5.9 5.9 0 0 0-1.4-.8V6.9c.5.2 1 .4 1.4.7Z" fill={dark} />
        </>
      );

    /* Transport: a bus, side on. */
    case 'transport':
      return (
        <>
          <rect x="2.2" y="5.8" width="19.6" height="11.6" rx="3.2" fill={c} />
          <rect x="4.4" y="8.2" width="6.2" height="4.4" rx="1.2" fill="#fff" />
          <rect x="12" y="8.2" width="6.2" height="4.4" rx="1.2" fill="#fff" />
          <rect x="4.4" y="14.2" width="15.2" height="1.6" rx="0.8" fill={light} />
          <circle cx="7.2" cy="18.4" r="2.4" fill={dark} />
          <circle cx="16.8" cy="18.4" r="2.4" fill={dark} />
        </>
      );

    /* Park: a fat cartoon tree with a shrub beside it. */
    case 'park':
      return (
        <>
          <rect x="10.8" y="12.5" width="2.5" height="8.3" rx="1.2" fill={dark} />
          <circle cx="7.6" cy="11.2" r="4.3" fill={c} />
          <circle cx="16.4" cy="11.2" r="4.3" fill={c} />
          <circle cx="12" cy="8" r="5.4" fill={light} />
          <circle cx="19.4" cy="18.2" r="2.6" fill={c} />
        </>
      );

    /* Community hub: a wide civic hall with a small dome. The dome has to sit ON a
       hall clearly wider than itself - a dome on a narrow base is a bell. */
    case 'community_hub':
      return (
        <>
          <path d="M7.5 11.6a4.5 4.5 0 0 1 9 0Z" fill={dark} />
          <rect x="2.8" y="11.6" width="18.4" height="7.6" rx="1.2" fill={c} />
          <path d="M9.7 19.2v-3a2.3 2.3 0 0 1 4.6 0v3Z" fill="#fff" />
          <rect x="4.9" y="14.2" width="2.6" height="2.6" rx="0.7" fill={light} />
          <rect x="16.5" y="14.2" width="2.6" height="2.6" rx="0.7" fill={light} />
          <rect x="1.8" y="19.2" width="20.4" height="1.9" rx="0.9" fill={dark} />
        </>
      );

    /* Technology hub: a tower broadcasting. The signal arcs stack ABOVE the mast -
       flanking the tower, they read as a robot's ears. */
    case 'technology_hub':
      return (
        <>
          <path d="M8.7 5.6a4.7 4.7 0 0 1 6.6 0" stroke={light} strokeWidth="1.7" strokeLinecap="round" fill="none" />
          <path d="M10.2 7.7a2.6 2.6 0 0 1 3.6 0" stroke={light} strokeWidth="1.7" strokeLinecap="round" fill="none" />
          <rect x="11.3" y="8.4" width="1.4" height="3.4" rx="0.7" fill={dark} />
          <circle cx="12" cy="9.4" r="1.5" fill={dark} />
          <rect x="7.6" y="10.8" width="8.8" height="10" rx="1.6" fill={c} />
          <rect x="9.2" y="12.6" width="2.2" height="2.2" rx="0.6" fill="#fff" />
          <rect x="12.6" y="12.6" width="2.2" height="2.2" rx="0.6" fill="#fff" />
          <rect x="9.2" y="15.8" width="2.2" height="2.2" rx="0.6" fill="#fff" />
          <rect x="12.6" y="15.8" width="2.2" height="2.2" rx="0.6" fill="#fff" />
          <rect x="6.4" y="20.2" width="11.2" height="1.6" rx="0.8" fill={dark} />
        </>
      );

    /* Shared resource hub: a toolbox. The handle is wide and flat on purpose - a
       narrow round shackle over a tall box is a padlock, which is what this was. */
    case 'shared_resource_hub':
      return (
        <>
          <path d="M7.6 10.6V9.2a2 2 0 0 1 2-2h4.8a2 2 0 0 1 2 2v1.4" stroke={dark} strokeWidth="1.9" strokeLinecap="round" fill="none" />
          <rect x="2" y="10.4" width="20" height="10.4" rx="2.2" fill={c} />
          <rect x="2" y="10.4" width="20" height="3.4" rx="1.7" fill={light} />
          <rect x="9.4" y="14.6" width="5.2" height="4.2" rx="1" fill="#fff" />
          <circle cx="5.6" cy="16.7" r="1" fill={dark} opacity="0.5" />
          <circle cx="18.4" cy="16.7" r="1" fill={dark} opacity="0.5" />
        </>
      );

    /* Culture & heritage: a columned temple front. */
    case 'culture_heritage':
      return (
        <>
          <path d="M12 2.8l9.6 5.1a.9.9 0 0 1-.42 1.7H2.82a.9.9 0 0 1-.42-1.7Z" fill={dark} />
          <rect x="4.2" y="10.4" width="2.6" height="7.6" rx="0.7" fill={c} />
          <rect x="8.6" y="10.4" width="2.6" height="7.6" rx="0.7" fill={light} />
          <rect x="12.8" y="10.4" width="2.6" height="7.6" rx="0.7" fill={c} />
          <rect x="17.2" y="10.4" width="2.6" height="7.6" rx="0.7" fill={light} />
          <rect x="2.6" y="18" width="18.8" height="2.8" rx="1" fill={dark} />
        </>
      );

    /* Unknown catalog id: a plain block, so the dock never renders an empty tile. */
    default:
      return (
        <>
          <rect x="4" y="6" width="16" height="14.8" rx="2.2" fill={c} />
          <rect x="7" y="9" width="4" height="4" rx="1" fill="#fff" />
          <rect x="13" y="9" width="4" height="4" rx="1" fill="#fff" />
        </>
      );
  }
}
