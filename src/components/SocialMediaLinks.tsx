import { cn } from '@/lib/utils';
import { PersonExternalIds } from '@/lib/types';

interface SocialMediaLinksProps {
    externalIds: PersonExternalIds | null;
    className?: string;
}

// SVG icons for social media platforms
const InstagramIcon = () => (
    <svg viewBox="0 0 24 24" className="w-4 h-4" fill="currentColor">
        <path d="M12 2.163c3.204 0 3.584.012 4.85.07 3.252.148 4.771 1.691 4.919 4.919.058 1.265.069 1.645.069 4.849 0 3.205-.012 3.584-.069 4.849-.149 3.225-1.664 4.771-4.919 4.919-1.266.058-1.644.07-4.85.07-3.204 0-3.584-.012-4.849-.07-3.26-.149-4.771-1.699-4.919-4.92-.058-1.265-.07-1.644-.07-4.849 0-3.204.013-3.583.07-4.849.149-3.227 1.664-4.771 4.919-4.919 1.266-.057 1.645-.069 4.849-.069zm0-2.163c-3.259 0-3.667.014-4.947.072-4.358.2-6.78 2.618-6.98 6.98-.059 1.281-.073 1.689-.073 4.948 0 3.259.014 3.668.072 4.948.2 4.358 2.618 6.78 6.98 6.98 1.281.058 1.689.072 4.948.072 3.259 0 3.668-.014 4.948-.072 4.354-.2 6.782-2.618 6.979-6.98.059-1.28.073-1.689.073-4.948 0-3.259-.014-3.667-.072-4.947-.196-4.354-2.617-6.78-6.979-6.98-1.281-.059-1.69-.073-4.949-.073zm0 5.838c-3.403 0-6.162 2.759-6.162 6.162s2.759 6.163 6.162 6.163 6.162-2.759 6.162-6.163c0-3.403-2.759-6.162-6.162-6.162zm0 10.162c-2.209 0-4-1.79-4-4 0-2.209 1.791-4 4-4s4 1.791 4 4c0 2.21-1.791 4-4 4zm6.406-11.845c-.796 0-1.441.645-1.441 1.44s.645 1.44 1.441 1.44c.795 0 1.439-.645 1.439-1.44s-.644-1.44-1.439-1.44z"/>
    </svg>
);

const TwitterIcon = () => (
    <svg viewBox="0 0 24 24" className="w-4 h-4" fill="currentColor">
        <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z"/>
    </svg>
);

const FacebookIcon = () => (
    <svg viewBox="0 0 24 24" className="w-4 h-4" fill="currentColor">
        <path d="M24 12.073c0-6.627-5.373-12-12-12s-12 5.373-12 12c0 5.99 4.388 10.954 10.125 11.854v-8.385H7.078v-3.47h3.047V9.43c0-3.007 1.792-4.669 4.533-4.669 1.312 0 2.686.235 2.686.235v2.953H15.83c-1.491 0-1.956.925-1.956 1.874v2.25h3.328l-.532 3.47h-2.796v8.385C19.612 23.027 24 18.062 24 12.073z"/>
    </svg>
);

const TikTokIcon = () => (
    <svg viewBox="0 0 24 24" className="w-4 h-4" fill="currentColor">
        <path d="M12.525.02c1.31-.02 2.61-.01 3.91-.02.08 1.53.63 3.09 1.75 4.17 1.12 1.11 2.7 1.62 4.24 1.79v4.03c-1.44-.05-2.89-.35-4.2-.97-.57-.26-1.1-.59-1.62-.93-.01 2.92.01 5.84-.02 8.75-.08 1.4-.54 2.79-1.35 3.94-1.31 1.92-3.58 3.17-5.91 3.21-1.43.08-2.86-.31-4.08-1.03-2.02-1.19-3.44-3.37-3.65-5.71-.02-.5-.03-1-.01-1.49.18-1.9 1.12-3.72 2.58-4.96 1.66-1.44 3.98-2.13 6.15-1.72.02 1.48-.04 2.96-.04 4.44-.99-.32-2.15-.23-3.02.37-.63.41-1.11 1.04-1.36 1.75-.21.51-.15 1.07-.14 1.61.24 1.64 1.82 3.02 3.5 2.87 1.12-.01 2.19-.66 2.77-1.61.19-.33.4-.67.41-1.06.1-1.79.06-3.57.07-5.36.01-4.03-.01-8.05.02-12.07z"/>
    </svg>
);

const YouTubeIcon = () => (
    <svg viewBox="0 0 24 24" className="w-4 h-4" fill="currentColor">
        <path d="M23.498 6.186a3.016 3.016 0 0 0-2.122-2.136C19.505 3.545 12 3.545 12 3.545s-7.505 0-9.377.505A3.017 3.017 0 0 0 .502 6.186C0 8.07 0 12 0 12s0 3.93.502 5.814a3.016 3.016 0 0 0 2.122 2.136c1.871.505 9.376.505 9.376.505s7.505 0 9.377-.505a3.015 3.015 0 0 0 2.122-2.136C24 15.93 24 12 24 12s0-3.93-.502-5.814zM9.545 15.568V8.432L15.818 12l-6.273 3.568z"/>
    </svg>
);

const IMDbIcon = () => (
    <svg viewBox="0 0 24 24" className="w-4 h-4" fill="currentColor">
        <path d="M14.31 9.588v.005c-.077-.048-.227-.07-.42-.07v4.815c.27 0 .44-.06.5-.165.062-.104.095-.405.095-.9v-2.953c0-.344-.013-.57-.04-.678-.03-.11-.075-.18-.135-.054zM22.416 0H1.62C.742.06.06.744 0 1.596v20.808c.058.852.74 1.536 1.62 1.596h20.796c.878-.06 1.56-.744 1.62-1.596V1.596C23.976.744 23.294.06 22.416 0zM4.14 15.147H2.732V8.1H4.14v7.047zm6.837 0H9.39v-4.18l-.075.617-.36 3.563h-1.18l-.39-3.323c-.035-.322-.063-.676-.08-1.06v4.383H5.91V8.1h1.897l.36 3.018c.03.217.044.407.044.57l.057-.57.39-3.018h1.89l-.57 7.047zm5.4-.93c0 .403-.012.673-.036.81-.023.138-.074.26-.15.366-.076.107-.184.193-.323.26-.14.067-.316.1-.533.1h-1.89V8.1h1.68c.34 0 .603.023.79.07.186.045.337.118.452.216.12.1.2.228.24.383.04.155.06.415.06.78v4.668zm5.5-.855c0 .456-.027.79-.08 1.003-.054.21-.163.396-.33.556-.166.16-.4.276-.7.35-.242.06-.605.09-1.088.09-.448 0-.78-.03-1-.09-.22-.06-.41-.153-.57-.28-.16-.127-.26-.278-.3-.45-.04-.173-.06-.49-.06-.95V8.1h1.393v5.67c0 .233.01.378.03.437.017.06.06.09.13.09.07 0 .113-.03.13-.09.017-.06.03-.204.03-.437V8.1h1.4v5.262h-.005z"/>
    </svg>
);

interface SocialLink {
    id: string | null;
    icon: React.ReactNode;
    getUrl: (id: string) => string;
    label: string;
    hoverColor: string;
}

export function SocialMediaLinks({ externalIds, className }: SocialMediaLinksProps) {
    if (!externalIds) return null;

    const socialLinks: SocialLink[] = [
        {
            id: externalIds.instagram_id,
            icon: <InstagramIcon />,
            getUrl: (id) => `https://instagram.com/${id}`,
            label: 'Instagram',
            hoverColor: 'hover:text-foreground',
        },
        {
            id: externalIds.twitter_id,
            icon: <TwitterIcon />,
            getUrl: (id) => `https://x.com/${id}`,
            label: 'X (Twitter)',
            hoverColor: 'hover:text-foreground',
        },
        {
            id: externalIds.facebook_id,
            icon: <FacebookIcon />,
            getUrl: (id) => `https://facebook.com/${id}`,
            label: 'Facebook',
            hoverColor: 'hover:text-foreground',
        },
        {
            id: externalIds.tiktok_id,
            icon: <TikTokIcon />,
            getUrl: (id) => `https://tiktok.com/@${id}`,
            label: 'TikTok',
            hoverColor: 'hover:text-foreground',
        },
        {
            id: externalIds.youtube_id,
            icon: <YouTubeIcon />,
            getUrl: (id) => `https://youtube.com/${id}`,
            label: 'YouTube',
            hoverColor: 'hover:text-foreground',
        },
        {
            id: externalIds.imdb_id,
            icon: <IMDbIcon />,
            getUrl: (id) => `https://imdb.com/name/${id}`,
            label: 'IMDb',
            hoverColor: 'hover:text-foreground',
        },
    ];

    const availableLinks = socialLinks.filter((link) => link.id);

    if (availableLinks.length === 0) return null;

    return (
        <div className={cn('flex items-center gap-3', className)}>
            {availableLinks.map((link) => (
                <a
                    key={link.label}
                    href={link.getUrl(link.id!)}
                    target="_blank"
                    rel="noopener noreferrer"
                    className={cn(
                        'text-muted-foreground transition-colors',
                        link.hoverColor
                    )}
                    aria-label={link.label}
                    title={link.label}
                >
                    {link.icon}
                </a>
            ))}
        </div>
    );
}

export default SocialMediaLinks;
