import {PGlite} from '@electric-sql/pglite';
import {readFileSync} from 'node:fs';
import {describe,it,expect} from 'vitest';
const sql=readFileSync('supabase/migrations/20261008021727_press_releases_route_reservation.sql','utf8');
describe('Press Releases route reservation',()=>{
 it('rejects collision in any restorable historical version and protects future drafts/publication only on this site',async()=>{
  const db=new PGlite();
  try{
   await db.exec(`create schema builder_private;create table builder_sites(id uuid primary key,site_key text);
    insert into builder_sites values('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','official-assembly-website-v2'),('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb','another-site');
    create table builder_entry_versions(site_id uuid,slug text,snapshot jsonb);
    create table builder_published_entries(site_id uuid,slug text,snapshot jsonb);
    insert into builder_entry_versions values('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','press-releases','{}');`);
   await expect(db.exec(sql)).rejects.toThrow('PRESS_RELEASES_ROUTE_COLLISION');
   await db.exec(`delete from builder_entry_versions`);await db.exec(sql);
   await expect(db.exec(`insert into builder_entry_versions values('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','press-releases','{}')`)).rejects.toThrow('reserved');
   await expect(db.exec(`insert into builder_published_entries values('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','different','{"slug":"press-releases"}')`)).rejects.toThrow('reserved');
   await db.exec(`insert into builder_entry_versions values('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb','press-releases','{}')`);
  }finally{await db.close();}
 },30000);
});
