import TheMovieDb from '@server/api/themoviedb';
import { IssueType, IssueTypeName } from '@server/constants/issue';
import { MediaType } from '@server/constants/media';
import { getRepository } from '@server/datasource';
import IssueComment from '@server/entity/IssueComment';
import Media from '@server/entity/Media';
import { User } from '@server/entity/User';
import notificationManager, { Notification } from '@server/lib/notifications';
import { Permission } from '@server/lib/permissions';
import logger from '@server/logger';
import { sortBy } from 'lodash';
import type { EntitySubscriberInterface, InsertEvent } from 'typeorm';
import { EventSubscriber } from 'typeorm';
import { defineMessages, useIntl } from 'react-intl';

const messages = defineMessages({
  open: 'Open',
  resolved: 'Resolved',
  requestedby: 'Requested by',
  requeststatus: 'Requets Status',
  commentfrom: 'Comment from',
  issuetype: 'Issue Typ',
  issuestatus: 'Issue Status',
  reportedby: 'Reported by',
  newcommenton: 'New Comment on',
  issue: 'Issue',
  requestapproved: 'Request Approved',
  requestdeclined: 'Request Declined',
  requestfor: 'Request',
  requestautosub: 'Request Automatically Submitted',
  requestautoapp: 'Request Automatically Approved',
  requestfailed: 'Request Failed',
  requestedseasons: 'Requested Seasons',
  pendingapproval: 'Pending Approval',
  requestprocess: 'Processing...',
  affectedseason: 'Affected Season',
  affectedepisode: 'Affected Epiosode',
  new: 'New',
  isssuereported: 'Issue Reported',
  issueresolved: 'Issue Solved',
  issuereopened: 'Issue Reopened',
  movierequestavail: 'Movie Request Now Available',
  serierequestavail: 'Series Request Now Available',
  tmdblang: {
    id: 'tmdblang',
    defaultMessage: 'en',
  },
});

@EventSubscriber()
export class IssueCommentSubscriber
  implements EntitySubscriberInterface<IssueComment>
{
  public listenTo(): typeof IssueComment {
    return IssueComment;
  }

  private async sendIssueCommentNotification(entity: IssueComment, intl: any) {
    let title: string;
    let image: string;
    const tmdb = new TheMovieDb();

    try {
      const issue = (
        await getRepository(IssueComment).findOneOrFail({
          where: { id: entity.id },
          relations: { issue: true },
        })
      ).issue;

      const createdBy = await getRepository(User).findOneOrFail({
        where: { id: issue.createdBy.id },
      });

      const media = await getRepository(Media).findOneOrFail({
        where: { id: issue.media.id },
      });

      if (media.mediaType === MediaType.MOVIE) {
        const movie = await tmdb.getMovie({ movieId: media.tmdbId, language: intl.formatMessage(messages.tmdblang) });

        title = `${movie.title}${
          movie.release_date ? ` (${movie.release_date.slice(0, 4)})` : ''
        }`;
        image = `https://image.tmdb.org/t/p/w600_and_h900_bestv2${movie.poster_path}`;
      } else {
        const tvshow = await tmdb.getTvShow({ tvId: media.tmdbId, language: intl.formatMessage(messages.tmdblang) });

        title = `${tvshow.name}${
          tvshow.first_air_date ? ` (${tvshow.first_air_date.slice(0, 4)})` : ''
        }`;
        image = `https://image.tmdb.org/t/p/w600_and_h900_bestv2${tvshow.poster_path}`;
      }

      const [firstComment] = sortBy(issue.comments, 'id');

      if (entity.id !== firstComment.id) {
        // Send notifications to all issue managers
        notificationManager.sendNotification(Notification.ISSUE_COMMENT, {
          event: `${intl.formatMessage(messages.newcommenton)} ${
            issue.issueType !== IssueType.OTHER
              ? `${IssueTypeName[issue.issueType]} `
              : ''
          }${intl.formatMessage(messages.issue)}`,
          subject: title,
          message: firstComment.message,
          comment: entity,
          issue,
          media,
          image,
          notifyAdmin: true,
          notifySystem: true,
          notifyUser:
            !createdBy.hasPermission(Permission.MANAGE_ISSUES) &&
            createdBy.id !== entity.user.id
              ? createdBy
              : undefined,
        });
      }
    } catch (e) {
      logger.error(
        'Something went wrong sending issue comment notification(s)',
        {
          label: 'Notifications',
          errorMessage: e.message,
          commentId: entity.id,
        }
      );
    }
  }

  public afterInsert(intl: any, event: InsertEvent<IssueComment>): void {
    if (!event.entity) {
      return;
    }

    this.sendIssueCommentNotification(event.entity, intl);
  }
}
