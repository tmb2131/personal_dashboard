import { TaskList } from "./_panels/task-list";
import { FooterStrip } from "./_panels/footer-strip";
import { HeroHeader } from "./_panels/hero-header";
import { Next3Days } from "./_panels/next-3-days";
import { Projects } from "./_panels/projects";
import { UpcomingTrips } from "./_panels/upcoming-trips";
import { LifeAreas } from "./_panels/life-areas";
import { ManualSyncButton } from "./_panels/manual-sync-button";
import { TodayRecurringTasksProvider } from "./_panels/today-recurring-tasks-context";
import { loadDashboardSafe } from "@/lib/dashboard-data";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export default async function DashboardPage() {
  const { data, error } = await loadDashboardSafe();

  if (error) {
    return (
      <main className="flex min-h-dvh items-center justify-center p-8">
        <div className="max-w-md space-y-3 rounded-lg border border-border bg-bg-elevated p-6">
          <h1 className="text-base font-medium">Setup needed</h1>
          <p className="text-sm text-fg-muted">
            The dashboard couldn&apos;t reach the database. Make sure{" "}
            <code className="rounded bg-bg px-1 font-mono text-[12px]">DATABASE_URL</code> is set
            and migrations have been run.
          </p>
          <pre className="overflow-x-auto rounded bg-bg p-3 font-mono text-[11px] text-fg-subtle">
{`# 1. Copy env template
cp .env.example .env.local

# 2. Fill in DATABASE_URL, GOOGLE_*, NOTION_TOKEN, TODOIST_TOKEN
# 3. Run migrations
npx drizzle-kit push

# 4. Start dev server
npm run dev`}
          </pre>
          <p className="text-[11px] text-fg-subtle">{error}</p>
        </div>
      </main>
    );
  }

  if (!data) return null;

  if (data.isEmpty) {
    return (
      <TodayRecurringTasksProvider>
        <main className="flex min-h-dvh flex-col">
          <HeroHeader meta={data.meta} initialNow={data.now} />
          <div className="flex flex-1 items-center justify-center p-8">
            <div className="max-w-md space-y-3 rounded-lg border border-border bg-bg-elevated p-6 text-center">
              <h2 className="text-base font-medium">No data yet</h2>
              <p className="text-sm text-fg-muted">
                Run an initial sync to pull your Notion, Todoist and Google Calendar data.
              </p>
              <div className="flex flex-col items-center gap-2">
                <ManualSyncButton size="md" />
              </div>
            <p className="text-[11px] text-fg-subtle">
              (Or trigger from the terminal:{" "}
              <code className="font-mono">curl -X POST localhost:3000/api/sync/run</code>)
            </p>
            </div>
          </div>
        </main>
      </TodayRecurringTasksProvider>
    );
  }

  return (
    <TodayRecurringTasksProvider>
      <main className="flex min-h-dvh flex-col">
        <HeroHeader meta={data.meta} initialNow={data.now} />
        <Next3Days groups={data.next3Days} />

        <div className="grid flex-1 min-h-0 grid-cols-1 gap-x-6 px-6 md:grid-cols-[minmax(280px,340px)_minmax(0,1fr)_minmax(280px,360px)]">
          <div className="min-w-0">
            <TaskList tasks={data.todayTasks} />
          </div>

          <div className="min-w-0">
            <Projects groups={data.projects} />
          </div>

          <div className="min-w-0">
            <UpcomingTrips trips={data.upcomingTrips} now={data.now} />
            <LifeAreas areas={data.lifeAreas} />
          </div>
        </div>

        <FooterStrip initialNow={data.now} lastSyncAt={data.lastSyncAt} />
      </main>
    </TodayRecurringTasksProvider>
  );
}
