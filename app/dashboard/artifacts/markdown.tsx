import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import styles from "./markdown.module.css";

// Renders agent output (chat replies, document artifacts) as GitHub-flavored Markdown. Raw HTML is not rendered,
// and react-markdown's default URL filter drops javascript: and other unsafe link targets.

const components: Components = {
  a: ({ href, children }) => <a href={href} target="_blank" rel="noopener noreferrer">{children}</a>,
  // Wide tables scroll inside the bubble or document instead of stretching the layout.
  table: ({ children }) => <div className={styles.tableWrap}><table>{children}</table></div>,
};

export function Markdown({ children, variant = "chat", className }: { children: string; variant?: "chat" | "document"; className?: string }) {
  return (
    <div className={`${styles.markdown} ${className ?? ""}`} data-variant={variant}>
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={components}>{children}</ReactMarkdown>
    </div>
  );
}
