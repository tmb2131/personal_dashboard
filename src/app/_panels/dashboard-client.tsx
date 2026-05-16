"use client";

import type { ReactNode } from "react";
import type { DashboardData } from "@/lib/dashboard-data";
import { cn } from "@/lib/utils";
import { AutoTodoistSync } from "./auto-todoist-sync";
import { DashboardMetaProvider } from "./dashboard-meta-context";
import {
  DashboardViewProvider,
  useDashboardView,
  type ViewId,
} from "./dashboard-view-context";
import { DashboardViewChips } from "./dashboard-view-chips";
import { FooterStrip } from "./footer-strip";
import { HeroHeader } from "./hero-header";
import { LifeAreas } from "./life-areas";
import { Next3Days } from "./next-3-days";
import { PersonalTaskList } from "./personal-task-list";
import { Projects } from "./projects";
import { ShortcutHelpOverlay } from "./shortcut-help-overlay";
import { SyncStatusProvider } from "./sync-status-context";
import { TaskList } from "./task-list";
import { TaskSectionShortcut } from "./task-section-shortcut";
import {
  TodayRecurringTasksProvider,
  useTodayRecurringTasksVisibility,
} from "./today-recurring-tasks-context";
import { UpcomingTrips } from "./upcoming-trips";

function View({
  show,
  when = true,
  className,
  children,
}: {
  show: ViewId[];
  when?: boolean;
  className?: string;
  children: ReactNode;
}) {
  const { activeView } = useDashboardView();
  const visible = show.includes(activeView) && when;
  return <div className={cn(className, !visible && "hidden")}>{children}</div>;
}

function DashboardBody({ data }: { data: DashboardData }) {
  const { activeView } = useDashboardView();
  const { showTodayRecurringSection } = useTodayRecurringTasksVisibility();

  const wide =
    activeView === "trips" ||
    activeView === "upcoming" ||
    (activeView === "today" && showTodayRecurringSection);

  const gridLayoutClass =
    activeView === "dashboard"
      ? "md:grid-cols-[minmax(280px,340px)_minmax(0,1fr)_minmax(280px,360px)]"
      : wide
      ? "mx-auto w-full max-w-5xl md:grid-cols-2"
      : "mx-auto w-full max-w-2xl";

  const tasksSplitMode = activeView === "today" ? "non-recurring" : undefined;

  return (
    <main
      data-active-view={activeView}
      className="flex min-h-dvh flex-col overflow-x-clip"
    >
      <HeroHeader meta={data.meta} initialNow={data.now} />
      <DashboardViewChips />

      <View show={["dashboard"]}>
        <Next3Days groups={data.next3Days} />
      </View>

      <div
        className={cn(
          "grid min-h-0 flex-1 grid-cols-1 gap-x-6 px-4 sm:px-6",
          gridLayoutClass,
        )}
      >
        <View show={["dashboard", "today", "upcoming"]} className="min-w-0">
          <TaskList
            tasks={data.todayTasks}
            notionProjectPicklist={data.notionProjectPicklist}
            splitMode={tasksSplitMode}
          />
          <View show={["dashboard"]}>
            <PersonalTaskList
              tasks={data.personalTasks}
              next7DaysTasks={data.next7DaysTasks}
            />
          </View>
        </View>

        <View
          show={["today"]}
          when={showTodayRecurringSection}
          className="min-w-0"
        >
          <TaskList
            tasks={data.todayTasks}
            notionProjectPicklist={data.notionProjectPicklist}
            splitMode="recurring"
          />
        </View>

        <View show={["upcoming"]} className="min-w-0">
          <PersonalTaskList
            tasks={data.personalTasks}
            next7DaysTasks={data.next7DaysTasks}
            defaultView="next7Days"
          />
        </View>

        <View show={["dashboard", "projects"]} className="min-w-0">
          <Projects
            groups={data.projects}
            categories={data.notionCategoryPicklist}
          />
        </View>

        <View show={["dashboard", "trips"]} className="min-w-0">
          <UpcomingTrips trips={data.upcomingTrips} now={data.now} showAdd />
          <View show={["dashboard"]}>
            <LifeAreas areas={data.lifeAreas} />
          </View>
        </View>

        <View show={["trips"]} className="min-w-0">
          <UpcomingTrips
            trips={data.datelessTrips}
            now={data.now}
            eyebrow="No date"
            sectionId="undated-trips"
            emptyCopy="No undated trip ideas"
            showAdd
          />
        </View>
      </div>

      <FooterStrip initialNow={data.now} lastSyncAt={data.lastSyncAt} />
      <ShortcutHelpOverlay />
      <TaskSectionShortcut />
    </main>
  );
}

export function DashboardClient({ data }: { data: DashboardData }) {
  return (
    <SyncStatusProvider>
      <DashboardMetaProvider meta={data.meta}>
        <TodayRecurringTasksProvider>
          <AutoTodoistSync />
          <DashboardViewProvider>
            <DashboardBody data={data} />
          </DashboardViewProvider>
        </TodayRecurringTasksProvider>
      </DashboardMetaProvider>
    </SyncStatusProvider>
  );
}
