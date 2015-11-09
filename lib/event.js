    event: {
      "event": "pullrequest:updated",
      "payload": {
        "repository": {
          "uuid": "{fe244cde-89ad-4342-ab77-a3655e9e7004}",
          "name": "zivtech",
          "owner": {
            "type": "team",
            "uuid": "{25111dea-fa08-49fc-9bde-cbd76b46821b}",
            "links": {
              "self": {
                "href": "https://api.bitbucket.org/2.0/teams/proboci"
              },
              "avatar": {
                "href": "https://bitbucket.org/account/proboci/avatar/32/"
              },
              "html": {
                "href": "https://bitbucket.org/proboci/"
              }
            },
            "display_name": "Probo.CI",
            "username": "proboci"
          },
          "is_private": true,
          "full_name": "proboci/zivtech",
          "type": "repository",
          "links": {
            "self": {
              "href": "https://api.bitbucket.org/2.0/repositories/proboci/zivtech"
            },
            "avatar": {
              "href": "https://bitbucket.org/proboci/zivtech/avatar/32/"
            },
            "html": {
              "href": "https://bitbucket.org/proboci/zivtech"
            }
          },
          "scm": "git"
        },
        "pullrequest": {
          "author": {
            "type": "user",
            "uuid": "{f9aa053b-3540-4093-9f6c-e02409c3c65b}",
            "links": {
              "self": {
                "href": "https://api.bitbucket.org/2.0/users/dzinkevich"
              },
              "avatar": {
                "href": "https://bitbucket.org/account/dzinkevich/avatar/32/"
              },
              "html": {
                "href": "https://bitbucket.org/dzinkevich/"
              }
            },
            "display_name": "Daniel Zinkevich",
            "username": "dzinkevich"
          },
          "participants": [
            {
              "user": {
                "type": "user",
                "uuid": "{f9aa053b-3540-4093-9f6c-e02409c3c65b}",
                "links": {
                  "self": {
                    "href": "https://api.bitbucket.org/2.0/users/dzinkevich"
                  },
                  "avatar": {
                    "href": "https://bitbucket.org/account/dzinkevich/avatar/32/"
                  },
                  "html": {
                    "href": "https://bitbucket.org/dzinkevich/"
                  }
                },
                "display_name": "Daniel Zinkevich",
                "username": "dzinkevich"
              },
              "role": "PARTICIPANT",
              "approved": false
            }
          ],
          "source": {
            "branch": {
              "name": "bitbucket_pr_test"
            },
            "repository": {
              "type": "repository",
              "links": {
                "self": {
                  "href": "https://api.bitbucket.org/2.0/repositories/proboci/zivtech"
                },
                "avatar": {
                  "href": "https://bitbucket.org/proboci/zivtech/avatar/32/"
                },
                "html": {
                  "href": "https://bitbucket.org/proboci/zivtech"
                }
              },
              "name": "zivtech",
              "uuid": "{fe244cde-89ad-4342-ab77-a3655e9e7004}",
              "full_name": "proboci/zivtech"
            },
            "commit": {
              "hash": "d96c25c4ae50",
              "links": {
                "self": {
                  "href": "https://api.bitbucket.org/2.0/repositories/proboci/zivtech/commit/d96c25c4ae50"
                }
              }
            }
          },
          "id": 1,
          "links": {
            "self": {
              "href": "https://api.bitbucket.org/2.0/repositories/proboci/zivtech/pullrequests/1"
            },
            "html": {
              "href": "https://bitbucket.org/proboci/zivtech/pull-requests/1"
            }
          },
          "title": "Just changing the README.",
          "updated_on": "2015-11-06T17:14:56.368222+00:00",
          "close_source_branch": false,
          "reason": "",
          "destination": {
            "branch": {
              "name": "master"
            },
            "repository": {
              "type": "repository",
              "links": {
                "self": {
                  "href": "https://api.bitbucket.org/2.0/repositories/proboci/zivtech"
                },
                "avatar": {
                  "href": "https://bitbucket.org/proboci/zivtech/avatar/32/"
                },
                "html": {
                  "href": "https://bitbucket.org/proboci/zivtech"
                }
              },
              "name": "zivtech",
              "uuid": "{fe244cde-89ad-4342-ab77-a3655e9e7004}",
              "full_name": "proboci/zivtech"
            },
            "commit": {
              "hash": "b2edcd2eca62",
              "links": {
                "self": {
                  "href": "https://api.bitbucket.org/2.0/repositories/proboci/zivtech/commit/b2edcd2eca62"
                }
              }
            }
          },
          "merge_commit": null,
          "description": "",
          "type": "pullrequest",
          "closed_by": null,
          "reviewers": [],
          "created_on": "2015-11-05T20:25:24.081476+00:00",
          "state": "OPEN"
        },
        "actor": {
          "type": "user",
          "uuid": "{f9aa053b-3540-4093-9f6c-e02409c3c65b}",
          "links": {
            "self": {
              "href": "https://api.bitbucket.org/2.0/users/dzinkevich"
            },
            "avatar": {
              "href": "https://bitbucket.org/account/dzinkevich/avatar/32/"
            },
            "html": {
              "href": "https://bitbucket.org/dzinkevich/"
            }
          },
          "display_name": "Daniel Zinkevich",
          "username": "dzinkevich"
        }
      },
      "protocol": "POST",
      "url": "https://bitbucket.org/proboci/zivtech/pull-requests/1"
    }
{ event: 'pullrequest:updated',
  payload:
   { repository:
      { uuid: '{fe244cde-89ad-4342-ab77-a3655e9e7004}',
        name: 'zivtech',
        owner:
         { type: 'team',
           uuid: '{25111dea-fa08-49fc-9bde-cbd76b46821b}',
           links:
            { self: { href: 'https://api.bitbucket.org/2.0/teams/proboci' },
              avatar: { href: 'https://bitbucket.org/account/proboci/avatar/32/' },
              html: { href: 'https://bitbucket.org/proboci/' } },
           display_name: 'Probo.CI',
           username: 'proboci' },
        is_private: true,
        full_name: 'proboci/zivtech',
        type: 'repository',
        links:
         { self: { href: 'https://api.bitbucket.org/2.0/repositories/proboci/zivtech' },
           avatar: { href: 'https://bitbucket.org/proboci/zivtech/avatar/32/' },
           html: { href: 'https://bitbucket.org/proboci/zivtech' } },
        scm: 'git' },
     pullrequest:
      { author:
         { type: 'user',
           uuid: '{f9aa053b-3540-4093-9f6c-e02409c3c65b}',
           links:
            { self: { href: 'https://api.bitbucket.org/2.0/users/dzinkevich' },
              avatar: { href: 'https://bitbucket.org/account/dzinkevich/avatar/32/' },
              html: { href: 'https://bitbucket.org/dzinkevich/' } },
           display_name: 'Daniel Zinkevich',
           username: 'dzinkevich' },
        participants:
         [ { user:
              { type: 'user',
                uuid: '{f9aa053b-3540-4093-9f6c-e02409c3c65b}',
                links:
                 { self: { href: 'https://api.bitbucket.org/2.0/users/dzinkevich' },
                   avatar: { href: 'https://bitbucket.org/account/dzinkevich/avatar/32/' },
                   html: { href: 'https://bitbucket.org/dzinkevich/' } },
                display_name: 'Daniel Zinkevich',
                username: 'dzinkevich' },
             role: 'PARTICIPANT',
             approved: false } ],
        source:
         { branch: { name: 'bitbucket_pr_test' },
           repository:
            { type: 'repository',
              links:
               { self: { href: 'https://api.bitbucket.org/2.0/repositories/proboci/zivtech' },
                 avatar: { href: 'https://bitbucket.org/proboci/zivtech/avatar/32/' },
                 html: { href: 'https://bitbucket.org/proboci/zivtech' } },
              name: 'zivtech',
              uuid: '{fe244cde-89ad-4342-ab77-a3655e9e7004}',
              full_name: 'proboci/zivtech' },
           commit:
            { hash: 'd96c25c4ae50',
              links: { self: { href: 'https://api.bitbucket.org/2.0/repositories/proboci/zivtech/commit/d96c25c4ae50' } } } },
        id: 1,
        links:
         { self: { href: 'https://api.bitbucket.org/2.0/repositories/proboci/zivtech/pullrequests/1' },
           html: { href: 'https://bitbucket.org/proboci/zivtech/pull-requests/1' } },
        title: 'Just changing the README.',
        updated_on: '2015-11-06T17:14:56.368222+00:00',
        close_source_branch: false,
        reason: '',
        destination:
         { branch: { name: 'master' },
           repository:
            { type: 'repository',
              links:
               { self: { href: 'https://api.bitbucket.org/2.0/repositories/proboci/zivtech' },
                 avatar: { href: 'https://bitbucket.org/proboci/zivtech/avatar/32/' },
                 html: { href: 'https://bitbucket.org/proboci/zivtech' } },
              name: 'zivtech',
              uuid: '{fe244cde-89ad-4342-ab77-a3655e9e7004}',
              full_name: 'proboci/zivtech' },
           commit:
            { hash: 'b2edcd2eca62',
              links: { self: { href: 'https://api.bitbucket.org/2.0/repositories/proboci/zivtech/commit/b2edcd2eca62' } } } },
        merge_commit: null,
        description: '',
        type: 'pullrequest',
        closed_by: null,
        reviewers: [],
        created_on: '2015-11-05T20:25:24.081476+00:00',
        state: 'OPEN' },
     actor:
      { type: 'user',
        uuid: '{f9aa053b-3540-4093-9f6c-e02409c3c65b}',
        links:
         { self: { href: 'https://api.bitbucket.org/2.0/users/dzinkevich' },
           avatar: { href: 'https://bitbucket.org/account/dzinkevich/avatar/32/' },
           html: { href: 'https://bitbucket.org/dzinkevich/' } },
        display_name: 'Daniel Zinkevich',
        username: 'dzinkevich' } },
  protocol: 'POST',
  url: 'https://bitbucket.org/proboci/zivtech/pull-requests/1' }