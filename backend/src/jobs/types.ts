export interface Job {
  sourceJobId?: string;
  url: string;
  title: string;
  company?: string;
  location?: string;
  description?: string;
  contactEmail?: string;
  employmentType?: string;
  salary?: string;
  deadline?: Date;
  postedAt?: Date;
}

export interface JobSource {
  readonly name: string;
  readonly baseUrl: string;
  fetchJobs(): Promise<Job[]>;
}
