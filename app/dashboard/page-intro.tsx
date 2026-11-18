import styles from "./dashboard.module.css";

/** Title and one-line description for dashboard sections that don't have content yet. */
export function PageIntro({ title, lead }: { title: string; lead: string }) {
  return (
    <section>
      <h1 className={styles.pageTitle}>{title}</h1>
      <p className={styles.pageLead}>{lead}</p>
    </section>
  );
}
